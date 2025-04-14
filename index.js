require('dotenv').config();
const express = require('express');
const { AzureOpenAI } = require('openai');
const app = express();
const port = process.env.PORT || 5000;
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
// const fetch = require('node-fetch');
const axios = require('axios');
const FormData = require('form-data');
// const fileUpload = require('express-fileupload');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' }); // Temporary storage for uploaded files
const cors = require('cors');



const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const azureOpenAIKey = process.env.AZURE_OPENAI_KEY;
const azureOpenAIEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
const azureOpenAIVersion = process.env.OPENAI_API_VERSION;

console.log("AZURE_OPENAI_KEY:", process.env.AZURE_OPENAI_KEY ? "✅ Loaded" : "❌ Missing");
console.log("AZURE_OPENAI_ENDPOINT:", process.env.AZURE_OPENAI_ENDPOINT ? "✅ Loaded" : "❌ Missing");
console.log("AZURE_OPENAI_DEPLOYMENT_NAME:", process.env.OPENAI_API_VERSION ? "✅ Loaded" : "❌ Missing");

console.log("AZURE_OPENAI_KEY:", process.env.AZURE_OPENAI_KEY);


if (!azureOpenAIKey || !azureOpenAIEndpoint || !azureOpenAIVersion) {
  throw new Error(
    "Please set AZURE_OPENAI_KEY, AZURE_OPENAI_ENDPOINT, and AZURE_OPENAI_DEPLOYMENT_NAME in your environment variables."
  );
}

const getClient = () => {
  const assistantsClient = new AzureOpenAI({
    endpoint: azureOpenAIEndpoint,
    apiVersion: azureOpenAIVersion,
    apiKey: azureOpenAIKey,
  });
  return assistantsClient;
};

const assistantsClient = getClient();

app.use(express.json());
app.use(cors());
// app.use(fileUpload());

// // Serve static files from the 'public' directory
// app.use(express.static(path.join(__dirname, 'public')));

// app.get("/", (req, res) => res.send("Congratulation 🎉🎉! Our Express server is Running on Vercel"));

app.get('/', (req, res) => {
  res.send('Hello, World!');
});
app.post('/upload-file', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const filePath = req.file.path;

  try {
    // Upload file to Azure
    const form = new FormData();
    form.append('purpose', 'assistants');
    form.append('file', fs.createReadStream(filePath));

    const response = await axios.post(
      `${azureOpenAIEndpoint}/openai/files?api-version=2024-05-01-preview`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          'api-key': azureOpenAIKey,
        },
      }
    );

    const fileId = response.data.id;

    // Return the file ID to the client
    res.json({ file_id: fileId });
  } catch (error) {
    console.error('Error uploading file:', error.message);
    res.status(500).json({ error: 'Failed to upload file' });
  } finally {
    // Clean up the uploaded file
    fs.unlinkSync(filePath);
  }
});


app.post('/ask', async (req, res) => {
  console.log('Received request at /ask endpoint');
  const userMessage = req.body.message;
  const fileid = req.body.file_id;
  if (!userMessage) {
    return res.status(400).json({ error: 'Message body parameter is required' });
  }
  // const uploadedFile = req.file;
  // let fileId = null;
  console.log('Received message:', fileid);

  // // Check if a file is uploaded
  // // const file = req.files?.file;
  // // if (req.files && req.files.file) {
  // //   // Process the file if it's present
  // //   console.log('File received:', req.files.file);
  // //   // Handle file upload logic here
  // // } else {
  // //   console.log('No file uploaded.');
  // // }
  // if (req.file) {
  //   console.log('File uploaded:', req.file);
  //   res.json({ message: 'File uploaded successfully', file: req.file });
  // } else {
  //   console.log('No file uploaded');
  //   res.status(400).json({ error: 'No file uploaded' });

  // if (file) {
  //   // File is uploaded, save the file locally
  //   const filePath = `uploads/${file.name}`;
  //   await file.mv(filePath);  // Save the file to disk
  //   console.log(`File uploaded to: ${filePath}`);

  //   // Create FormData and send to Azure API
  //   const form = new FormData();
  //   form.append('purpose', 'assistants');
  //   form.append('file', fs.createReadStream(filePath));

  //   try {
  //     // Send the file to Azure
  //     const response = await axios.post(
  //       'https://azure2234.openai.azure.com/openai/files?api-version=2024-08-01-preview',
  //       form,
  //       {
  //         headers: {
  //           ...form.getHeaders(),
  //           'api-key': process.env.AZURE_OPENAI_API_KEY, // Set your API key
  //         },
  //       }
  //     );

  //     // Extract file ID from the response
  //     fileId = response.data.id;
  //     console.log(`File uploaded to Azure. File ID: ${fileId}`);
  //   } catch (error) {
  //     console.error('Error uploading file:', error.message);
  //     return res.status(500).json({ error: 'Failed to upload file to Azure' });
  //   }
  // } else {
  //   console.log('No file uploaded.');
  // }

  const options = {
    model: "gpt-4o",
    name: "Assistant867",
    instructions: "You are here to visualize and generate charts and graphs. You are also going to process Excel files that is used for summarization.",
    tools: [{ type: "code_interpreter" }],
    // tool_resources: { code_interpreter: { file_ids: [] } },
    tool_resources: fileid ? { code_interpreter: { file_ids: [fileid] } } : undefined,
    temperature: 0.7,
    top_p: 0.9,
  };
  const role = "user";
  const message = userMessage;
  console.log('Processing request...');

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

      const downloadLinks = [];
      let imageBase64 = null;
      let botText = null;

      for await (const runMessageDatum of messagesResponse) {
        for (const item of runMessageDatum.content) {
          if (item.type === "text" && item.text?.annotations && item.text?.value) {
            if (runMessageDatum.role === "assistant") {
              botText = item.text.value; // Extract the bot's response text
            }
            const annotations = item.text.annotations.filter(ann => ann.type === 'file_path');
            for (const annotation of annotations) {
              const filePath = annotation.text.replace('sandbox:', '');
              const fileId = annotation.file_path.file_id;

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
                      console.log(`Download link: ${downloadLink}`);
                      downloadLinks.push(downloadLink);
              } catch (error) {
                console.error(`Error fetching file: ${error.message}`);
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
              imageBase64 = Buffer.from(arrayBuffer).toString('base64');
            } catch (error) {
              console.error(`Error retrieving image file: ${error.message}`);
            }
          }
        }
      }

      // Return only the download links if files are requested
      if (downloadLinks.length > 0) {
        return res.json({
          bot_text: botText || 'No bot response available.', 
          download_links: downloadLinks 
        });
      }

      // Return the image if no files are requested
      if (imageBase64) {
        return res.json({ 
          bot_text: botText || 'No bot response available.',
          image: `data:image/png;base64,${imageBase64}` 
        });
      }

      if (botText) {
        return res.json({ bot_text: botText || 'No bot response available.', });
      }

      // If neither files nor images are available
      return res.status(404).json({ error: 'No files or images were generated.' });
    } else {
      return res.status(500).json({ error: 'Failed to fetch messages' });
    }
  } catch (error) {
    console.error(`Error running the assistant: ${error.message}`);
    return res.status(500).json({ error: error.message });
  }
  });
  // app.get('/download', async (req, res) => {
  //   const filePath = req.query.filePath;
  //   const fileId = req.query.fileId;
  //   const fileName = path.basename(filePath);
  
  //   try {
  //     const fileResponse = await fetch(`https://azure2234.openai.azure.com/openai/files/${fileId}/content?api-version=2024-05-01-preview`, {
  //       headers: {
  //         'api-key': process.env.AZURE_OPENAI_KEY
  //       }
  //     });
  
  //     if (!fileResponse.ok) {
  //       throw new Error('Failed to fetch file from Azure');
  //     }
  
  //     const fileBuffer = await fileResponse.buffer();
  //     res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  //     res.send(fileBuffer);
  //     console.log(`File ${fileName} downloaded successfully.`);
  //   } catch (error) {
  //     console.error('Error downloading file:', error);
  //     res.status(500).send('Error downloading file');
  //   }
  // });

//   if (process.env.NODE_ENV !== 'production') {
//     const port = process.env.PORT || 5000;
//     app.listen(port, () => {
//       console.log(`Server is running on http://localhost:${port}`);
//     });
//   }
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
  });
  
  // Export the app for Vercel
  module.exports = app;