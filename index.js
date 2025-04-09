require('dotenv').config();
const express = require('express');
const { AzureOpenAI } = require('openai');
const app = express();
const port = process.env.PORT || 5000;
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const cors = require('cors');
const os = require('os');

const azureOpenAIKey = process.env.AZURE_OPENAI_KEY;
const azureOpenAIEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
const azureOpenAIVersion = process.env.OPENAI_API_VERSION;

if (!azureOpenAIKey || !azureOpenAIEndpoint || !azureOpenAIVersion) {
  throw new Error("Please set AZURE_OPENAI_KEY, AZURE_OPENAI_ENDPOINT, and OPENAI_API_VERSION in environment variables.");
}

const assistantsClient = new AzureOpenAI({
  endpoint: azureOpenAIEndpoint,
  apiVersion: azureOpenAIVersion,
  apiKey: azureOpenAIKey,
});

app.use(express.json());
app.use(cors());

const server = app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

server.setTimeout(120000);

app.get('/', (req, res) => {
  res.send('Hello, World!');
});

app.post('/upload-file', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const filePath = req.file.path;
    const form = new FormData();
    form.append('purpose', 'assistants');
    form.append('file', fs.createReadStream(filePath));

    const response = await axios.post(`${azureOpenAIEndpoint}/openai/files?api-version=2024-05-01-preview`, form, {
      headers: { ...form.getHeaders(), 'api-key': azureOpenAIKey },
    });

    // Check if the response is JSON
    if (response.headers['content-type']?.includes('application/json')) {
      res.json({ file_id: response.data.id });
    } else {
      console.error('Unexpected response:', response.data);
      res.status(500).json({ error: 'Unexpected response from server' });
    }
  } catch (error) {
    if (error.response) {
      // Log the server's response
      console.error('Server Error:', error.response.status, error.response.data);
      res.status(error.response.status).json({ error: error.response.data });
    } else {
      console.error('Upload Error:', error.message);
      res.status(500).json({ error: 'Failed to upload file' });
    }
  } finally {
    fs.unlinkSync(req.file.path);
  }
});

app.post('/ask', async (req, res) => {
  console.log('Received request at /ask endpoint');
  const { message, file_id } = req.body;
  console.log(file_id)
  console.log(message)

  if (!message) return res.status(400).json({ error: 'Message body parameter is required' });

  const options = {
    model: "gpt-4o",
    name: "Assistant129",
    instructions: "You can generate charts, summarize Excel files, and more.",
    tools: [{ type: "code_interpreter" }],
    tool_resources: file_id ? { code_interpreter: { file_ids: [file_id] } } : undefined,
    temperature: 0.7,
    top_p: 0.9,
  };

  try {
    const assistantResponse = await assistantsClient.beta.assistants.create(options);
    const thread = await assistantsClient.beta.threads.create({});
    await assistantsClient.beta.threads.messages.create(thread.id, { role: "user", content: message });

    const run = await assistantsClient.beta.threads.runs.create(thread.id, { assistant_id: assistantResponse.id });

    let runStatus = run.status;
    let attempt = 0;
    const maxAttempts = 20;

    while (runStatus === 'queued' || runStatus === 'in_progress') {
      if (attempt >= maxAttempts) {
        return res.status(504).json({ error: 'Processing took too long. Try again later.' });
      }
      await new Promise(resolve => setTimeout(resolve, 1000 + attempt * 200));
      attempt++;

      const runStatusResponse = await assistantsClient.beta.threads.runs.retrieve(thread.id, run.id);
      runStatus = runStatusResponse.status;
      console.log(`Current run status: ${runStatus}`);
    }

    if (runStatus === 'completed') {
      const messagesResponse = await assistantsClient.beta.threads.messages.list(thread.id);
      console.log(`Messages in the thread: ${JSON.stringify(messagesResponse)}`);
      
      // Your provided code is placed here without modification
      const messages = [];
      let firstResponseAdded = false;
      let fileName = '';
      let filePath = '';
      let fileId = '';
      for await (const runMessageDatum of messagesResponse) {
        for (const item of runMessageDatum.content) {
            if (!firstResponseAdded){
              if (item.type === "text") {
                messages.push({ type: "text", content: item.text?.value});
                console.log(`Message: ${item.text?.value}`);
                console.log(`Attachment: ${JSON.stringify(item.text?.annotations)}`);
                firstResponseAdded = true;
                // const baseName = item.text?.value.split(' ').slice(-1)[0];
                // let extension = 'xlsx'; // Default extension
                // if (item.text?.value.includes('DOCX')) {
                //   extension = 'docx';
                // } else if (item.text?.value.includes('PDF')) {
                //   extension = 'pdf';
                // } else if (item.text?.value.includes('PPTX')) {
                //   extension = 'pptx';
                // }
                // fileName = `${baseName}.${extension}`;
                // // console.log(`Generated filename: ${fileName}`);
                if (item.text?.annotations) {
                  const annotations = item.text.annotations.filter(ann => ann.type === 'file_path');
                  for (const annotation of annotations) {
                    const filePath = annotation.text.replace('sandbox:', '');
                    const fileId = annotation.file_path.file_id;
                    console.log(`Extracted file path: ${filePath}`);
                    console.log(`Extracted file ID: ${fileId}`);

                    const downloadsDir = process.env.RENDER === 'true'
                      ? '/opt/render/Downloads'  // If it's running on Render
                      : path.join(os.homedir(), 'Downloads');  // If running locally
                      console.log('RENDER environment variable:', process.env.AZURE);


                    // Serve the files in the /downloads route
                    app.use('/downloads', express.static(downloadsDir, {
                      setHeaders: (res, filePath) => {
                        console.log(`Serving file: ${filePath}`);
                      }
                    }));

                    // Define the destination path for saving files
                    const destPath = path.join(downloadsDir, path.basename(filePath));
                
                    // Ensure the downloads directory exists
                    // if (!fs.existsSync(downloadsDir)) {
                    //   fs.mkdirSync(downloadsDir);
                    // }
                    // app.use('/downloads', express.static(downloadsDir));
                    if (!fs.existsSync(downloadsDir)) {
                      fs.mkdirSync(downloadsDir, { recursive: true });
                    }
                    // Define the file URL
                    const fileUrl = `https://butch-m8idpr5x-australiaeast.cognitiveservices.azure.com/openai/files/${fileId}/content?api-version=2024-05-01-preview`;
                
                    try {
                      // Fetch and download the file from URL
                      const response = await fetch(fileUrl, {
                        headers: {
                          'api-key': process.env.AZURE_OPENAI_KEY
                        }
                      });
                
                      if (!response.ok) {
                        throw new Error(`Failed to download file: ${response.statusText}`);
                      }
                
                      // Get the file content as an array buffer
                      const arrayBuffer = await response.arrayBuffer();
                      const buffer = Buffer.from(arrayBuffer);
                
                      // Write the buffer to a file
                      fs.writeFileSync(destPath, buffer);
                
                      console.log(`File downloaded to: ${destPath}`);
                      if (fs.existsSync(destPath)) {
                        console.log(`File saved successfully at: ${destPath}`);
                      } else {
                        console.log(`Error: File not found at path: ${destPath}`);
                      }
                      // Generate a download link message
                      // const destPath = path.join(downloadsDir, path.basename(filePath));
                      const downloadLink = process.env.AZURE === 'true'
                      ? `https://ihisenpaipoc-azcva3bcexc2d3dd.southeastasia-01.azurewebsites.net/downloads/${path.basename(filePath)}`
                      : `http://localhost:${port}/downloads/${path.basename(filePath)}`;


                      console.log(`File downloaded to: ${destPath}`);
                      console.log(`Accessible link: ${downloadLink}`);
                      messages.push({ type: "text", content: `File is available for download: ${downloadLink}` });
                    } catch (error) {
                      console.error(`Error fetching file: ${error.message}`);
                    }
                  }
                }
              } else if (item.type === "image_file") {
                try {
                  const imageResponse = await fetch(`https://butch-m8idpr5x-australiaeast.cognitiveservices.azure.com/openai/files/${item.image_file.file_id}/content?api-version=2024-05-01-preview`, {
                    headers: {
                      'api-key': process.env.AZURE_OPENAI_KEY
                    }
                  });
                  const arrayBuffer = await imageResponse.arrayBuffer();
                  const base64Image = Buffer.from(arrayBuffer).toString('base64');
                  console.log(base64Image);
                  const decodedResponse = Buffer.from(base64Image, 'base64').toString('utf-8');
                  
                  // Check if the response is an error message
                  if (decodedResponse.includes('"error"')) {
                    console.error(`Error retrieving image file: ${decodedResponse}`);
                  } else {
                    messages.push({ type: "image", content: base64Image });
                  }
                } catch (error) {
                  console.error(`Error retrieving image file: ${error.message}`);
                }
            }
            }
        }
      }
    
    res.json({ messages });
  } else {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
  } catch (error) {
    console.error(`Error running the assistant: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

process.on('unhandledRejection', error => {
  console.error('Unhandled Rejection:', error);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => process.exit(0));
});
