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

const azureOpenAIKey = process.env.AZURE_OPENAI_KEY;
const azureOpenAIEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
const azureOpenAIVersion = process.env.OPENAI_API_VERSION;


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

// // Serve static files from the 'public' directory
// app.use(express.static(path.join(__dirname, 'public')));

// app.get("/", (req, res) => res.send("Congratulation 🎉🎉! Our Express server is Running on Vercel"));

app.post('/ask', async (req, res) => {
  console.log('Received request at /ask endpoint');
  const userMessage = req.body.message;
  if (!userMessage) {
    return res.status(400).json({ error: 'Message body parameter is required' });
  }

  const options = {
    model: "gpt-4o-mini-2",
    name: "Assistant129",
    instructions: "You are here to visualize and generate charts and graphs. You are also generate contents for business reports, presentations, and proposals",
    tools: [{ type: "code_interpreter" }],
    tool_resources: {"code_interpreter":{"file_ids":[]}},
    temperature: 1,
    top_p: 1
  };
  const role = "user";
  const message = userMessage;
  console.log('Processing request...');

  try {
    // Create an assistant
    const assistantResponse = await assistantsClient.beta.assistants.create(options);
    console.log(`Assistant created: ${JSON.stringify(assistantResponse)}`);

    // Create a thread
    const assistantThread = await assistantsClient.beta.threads.create({});
    console.log(`Thread created: ${JSON.stringify(assistantThread)}`);

    // Add a user question to the thread
    const threadResponse = await assistantsClient.beta.threads.messages.create(
      assistantThread.id,
      {
        role,
        content: message,
      }
    );
    console.log(`Message created: ${JSON.stringify(threadResponse)}`);

    // Run the thread
    const runResponse = await assistantsClient.beta.threads.runs.create(
      assistantThread.id,
      {
        assistant_id: assistantResponse.id,
      }
    );
    console.log(`Run started: ${JSON.stringify(runResponse)}`);

    // Polling until the run completes or fails
    let runStatus = runResponse.status;
    while (runStatus === 'queued' || runStatus === 'in_progress') {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const runStatusResponse = await assistantsClient.beta.threads.runs.retrieve(
        assistantThread.id,
        runResponse.id
      );
      runStatus = runStatusResponse.status;
      console.log(`Current run status: ${runStatus}`);
    }

     // Get the messages in the thread once the run has completed
     if (runStatus === 'completed') {
        const messagesResponse = await assistantsClient.beta.threads.messages.list(
            assistantThread.id
          );
          console.log(`Messages in the thread: ${JSON.stringify(messagesResponse)}`);
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

                        const isRender = process.env.RENDER === 'true'; // Use an environment variable to check if on Render
                        const downloadsDir = isRender ? '/opt/render/Downloads' : path.join(os.homedir(), 'Downloads');
                        // Define the destination path
                        // const downloadsDir = path.join(os.homedir(), 'Downloads');
                        const destPath = path.join(downloadsDir, path.basename(filePath));
                    
                        // Ensure the downloads directory exists
                        // if (!fs.existsSync(downloadsDir)) {
                        //   fs.mkdirSync(downloadsDir);
                        // }
                        if (!fs.existsSync(downloadsDir)) {
                          fs.mkdirSync(downloadsDir, { recursive: true });
                        }
                        // Define the file URL
                        const fileUrl = `https://azure2234.openai.azure.com/openai/files/${fileId}/content?api-version=2024-05-01-preview`;
                    
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
                    
                          // Generate a download link message
                          const destPath = path.join(downloadsDir, path.basename(filePath));
                          const downloadLink = isRender
                            ? `/opt/render/Downloads/${path.basename(filePath)}` // Log Render-specific path
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
                      const imageResponse = await fetch(`https://azure2234.openai.azure.com/openai/files/${item.image_file.file_id}/content?api-version=2024-05-01-preview`, {
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