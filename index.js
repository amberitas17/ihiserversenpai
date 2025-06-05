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
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/'); // or wherever you're storing uploads
  },
  filename: function (req, file, cb) {
    // Keep original file extension
    cb(null, file.originalname);
  }
});
const upload = multer({ storage }); // Temporary storage for uploaded files
const cors = require('cors');
const crypto = require('crypto');



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
const uploadAudio = multer({ dest: 'uploads/' });
const transcriptions = {}; // In-memory store

app.post('/audio-transcribe', uploadAudio.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file uploaded.' });
  }

  const apiKey = process.env.AZURE_OPENAI_KEY2;
  const endpoint = 'https://ai-cherry1273ai188374557557.cognitiveservices.azure.com/openai/deployments/gpt-4o-transcribe/audio/transcriptions?api-version=2025-03-01-preview';

  try {
    const form = new FormData();
    form.append('model', 'gpt-4o-transcribe');

    // Ensure the filename is UTF-8
    let originalName = req.file.originalname;
    if (/[\x80-\xFF]/.test(originalName)) {
      // If there are non-ASCII bytes, try decoding as latin1 to utf8
      originalName = Buffer.from(originalName, 'latin1').toString('utf8');
    }

    form.append('file', fs.createReadStream(req.file.path), originalName);
        

    const response = await axios.post(endpoint, form, {
      headers: {
        ...form.getHeaders(),
        'Authorization': `Bearer ${apiKey}`,
      },
      maxBodyLength: Infinity,
    });

    fs.unlinkSync(req.file.path);

    const filenameWithoutExt = path.basename(originalName, path.extname(originalName));
    // Store transcription by filename
    transcriptions[filenameWithoutExt] = response.data.text;

    res.json({
      filename: filenameWithoutExt
    });
  } catch (error) {
    fs.unlinkSync(req.file.path);
    console.error('Audio transcription error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to transcribe audio', details: error.response?.data || error.message });
  }
});
app.get('/audio-transcribe/:filename', (req, res) => {
  const { filename } = req.params;
  const text = transcriptions[filename];
  if (text) {
    res.json({ text });
  } else {
    res.status(404).json({ error: 'Transcription not found for this filename.' });
  }
});
const activeVectorStores = {}; // Key: session ID, Value: vector store ID
app.post('/upload-file', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const filePath = req.file.path;
  const fileExtension = path.extname(req.file.originalname).toLowerCase(); // Get the file extension
  console.log('Received file:', req.file.originalname);
  console.log('File path:', filePath);

  try {
    // Step 1: Upload the file to Azure OpenAI to get a file_id
    console.log('Uploading file to Azure OpenAI...');
    const form = new FormData();
    form.append('purpose', 'assistants');
    form.append('file', fs.createReadStream(filePath));

    const fileUploadResponse = await axios.post(
      `${azureOpenAIEndpoint}/openai/files?api-version=2024-05-01-preview`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          'api-key': azureOpenAIKey,
        },
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          console.log(`Upload progress: ${percentCompleted}%`);
        },
      }
    );

    const fileId = fileUploadResponse.data.id;
    console.log(`File uploaded to Azure OpenAI with ID: ${fileId}`);
    // Check if the file is .docx or .pdf
    if (fileExtension === '.xlsx' || fileExtension === '.csv') {
      console.log('File is in .xlsx or .csv format. Skipping vector store creation.');
      return res.json({
        message: 'File uploaded successfully. No vector store created for .docx or .pdf files.',
        file_id: fileId,
      });
    }

    // Step 2: Check for an existing vector store and delete it
    const sessionId = req.headers['x-session-id'] || crypto.randomUUID(); // Use a session ID from the client or generate one
    if (activeVectorStores[sessionId]) {
      const oldVectorStoreId = activeVectorStores[sessionId];
      console.log(`Deleting old vector store with ID: ${oldVectorStoreId}`);
      try {
        await axios.delete(
          `${azureOpenAIEndpoint}/openai/vector_stores/${oldVectorStoreId}?api-version=2024-05-01-preview`,
          {
            headers: {
              'api-key': azureOpenAIKey,
            },
          }
        );
        console.log(`Old vector store ${oldVectorStoreId} deleted successfully.`);
      } catch (error) {
        console.error(`Error deleting old vector store ${oldVectorStoreId}:`, error.message);
      }
    }

    // Step 2: Create a vector store
    const vectorStoreName = `VectorStore_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    console.log(`Generated vector store name: ${vectorStoreName}`);
    console.log('Creating vector store...');
    const vectorStoreResponse = await axios.post(
      `${azureOpenAIEndpoint}/openai/vector_stores?api-version=2024-05-01-preview`,
      { name: vectorStoreName },
      {
        headers: {
          'api-key': azureOpenAIKey,
          'Content-Type': 'application/json',
        },
      }
    );

    const vectorStoreId = vectorStoreResponse.data.id;
    console.log(`Vector store created with ID: ${vectorStoreId}`);

    // Step 3: Associate the file with the vector store
    console.log('Associating file with vector store...');
    await axios.post(
      `${azureOpenAIEndpoint}/openai/vector_stores/${vectorStoreId}/files?api-version=2024-05-01-preview`,
      { file_id: fileId },
      {
        headers: {
          'api-key': azureOpenAIKey,
          'Content-Type': 'application/json',
        },
      }
    );
    // const sessionId = req.headers['x-session-id'] || crypto.randomUUID(); // Use a session ID from the client or generate one
    activeVectorStores[sessionId] = vectorStoreId;
    console.log(`Stored vector store ID ${vectorStoreId} for session ${sessionId}`);

    // Return the file ID and vector store ID to the client
    res.json({
      message: 'File uploaded and associated with vector store successfully',
      file_id: fileId,
      vector_store_id: vectorStoreId,
    });
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to upload file or associate with vector store',
      details: error.response?.data || error.message,
    });
  } finally {
    // Clean up the uploaded file
    fs.unlinkSync(filePath);
  }
});


app.post('/ask', async (req, res) => {
  console.log('Received request at /ask endpoint');
  const userMessage = req.body.message;
  const fileid = req.body.file_id;
  console.log('Received file ID:', fileid);
  if (!userMessage) {
    return res.status(400).json({ error: 'Message body parameter is required' });
  }




  // if (!vectorStoreId) {
  //   return res.status(400).json({ error: 'Vector Store ID is required for file search' });
  // }
   // Retrieve the vector store ID associated with the file ID
   // Retrieve the vector store ID associated with the session ID
  // Use the provided session ID or fallback to the most recent vector store
  const sessionId = req.headers['x-session-id'];
  let vectorStoreId;

  if (sessionId) {
    vectorStoreId = activeVectorStores[sessionId];
  } else {
    // Retrieve the most recently created vector store ID
    const recentSessionId = Object.keys(activeVectorStores).pop();
    vectorStoreId = activeVectorStores[recentSessionId];
  }

// Retrieve the original file name from Azure OpenAI or your storage system
// Retrieve the original file name from Azure OpenAI or your storage system
let originalFileName = null;
let fileExtension = null;
let isExcelOrCsv = false;
if (fileid) {
  try {
    // Retrieve the original file name from Azure OpenAI
    const fileDetailsResponse = await axios.get(
      `${azureOpenAIEndpoint}/openai/files/${fileid}?api-version=2024-05-01-preview`,
      {
        headers: {
          'api-key': azureOpenAIKey,
        },
      }
    );

    console.log('File details response:', fileDetailsResponse.data);

    originalFileName = fileDetailsResponse.data.filename; // Retrieve the original file name
    if (!originalFileName) {
      console.warn('File name is missing in the response. Using a default name.');
      originalFileName = `unknown_file_${fileid}`;
    }

    console.log(`Original file name: ${originalFileName}`);
    fileExtension = path.extname(originalFileName).toLowerCase();
    isExcelOrCsv = fileExtension === '.xlsx' || fileExtension === '.csv';
  } catch (error) {
    console.error('Error retrieving file details:', error.response?.data || error.message);
    console.warn('Proceeding without file details as file_id is optional.');
  }
} else {
  console.log('No file ID provided. Proceeding without file-related operations.');
}

// Ensure fileExtension and isExcelOrCsv are initialized
if (originalFileName && !fileExtension) {
  try {
    fileExtension = path.extname(originalFileName).toLowerCase();
    isExcelOrCsv = fileExtension === '.xlsx' || fileExtension === '.csv';
  } catch (error) {
    console.error('Error determining file extension:', error.message);
    return res.status(500).json({ error: 'Failed to determine file extension' });
  }
}


if (!vectorStoreId && !isExcelOrCsv) {
  console.warn('No vector store found and the file is not in .xlsx or .csv format. Proceeding without these.');
}


  // const uploadedFile = req.file;
  // let fileId = null;
  console.log('Received message:', userMessage);
  console.log('Received vector store ID:', vectorStoreId);

  const modifiedMessage = fileid
    ? `File ID: ${fileid}\n\n${userMessage}`
    : userMessage;

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

  const wantsOnlyCodeInterpreter =
  !fileid && !vectorStoreId &&
  /bar chart|line chart|pie chart|plot|draw|chart|graph/i.test(userMessage) &&
  /\d/.test(userMessage); // crude check for numbers

const tools = wantsOnlyCodeInterpreter
  ? [{ type: "code_interpreter" }]
  : [{ type: "code_interpreter" }, { type: "file_search" }];

const tool_resources = wantsOnlyCodeInterpreter
  ? undefined
  : {
      code_interpreter: fileid ? { file_ids: [fileid] } : undefined,
      file_search: vectorStoreId ? { vector_store_ids: [vectorStoreId] } : undefined,
    };

const options = {
  model: "gpt-4o",
  name: "Assistant133",
  instructions: "You are here to visualize and generate charts and graphs. You are also going to process Excel files that is used for summarization.",
  tools,
  tool_resources,
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

      const processMessages = async () => {
        // Ensure messagesResponse.data is used, as it contains the array of messages
        let botFinalMessage = null;
        let botSecondMessage = null;
        const messageTasks = messagesResponse.data.map(async (runMessageDatum, index) => {
          // Map over content to process each item concurrently
          const contentTasks = runMessageDatum.content.map(async (item) => {
            if (item.type === "text" && item.text?.value) {
              if (runMessageDatum.role === "assistant") {
                if (!botSecondMessage && index === 0) {
                  botSecondMessage = item.text.value;
                }
                // Always update the final message
                botFinalMessage = item.text.value;
              }
              const annotations = item.text.annotations?.filter(ann => ann.type === 'file_path') || [];
              // Process annotations concurrently
              const annotationTasks = annotations.map(async (annotation) => {
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
      
                const fileUrl = `https://azure2234.openai.azure.com/openai/files/${fileId}/content?api-version=2024-05-01-preview`;
      
                try {
                  const response = await fetch(fileUrl, {
                    headers: {
                      'api-key': process.env.AZURE_OPENAI_KEY
                    }
                  });
      
                  if (!response.ok) {
                    throw new Error(`Failed to download file: ${response.statusText}`);
                  }
      
                  const arrayBuffer = await response.arrayBuffer();
                  const buffer = Buffer.from(arrayBuffer);
                  const destPath = path.join(downloadsDir, path.basename(filePath));
                  fs.writeFileSync(destPath, buffer);
      
                  const downloadLink = process.env.AZURE === 'true'
                    ? `https://ihisenpaitest-fbdxe3dqdch4drg6.eastus-01.azurewebsites.net/downloads/${path.basename(filePath)}`
                    : `http://localhost:${port}/downloads/${path.basename(filePath)}`;
      
                    console.log(`File downloaded to: ${destPath}`);
                    console.log(`Accessible link: ${downloadLink}`);
                    console.log(`Download link: ${downloadLink}`);
                    downloadLinks.push(downloadLink);
                } catch (error) {
                  console.error(`Error fetching file: ${error.message}`);
                }
              });
      
              await Promise.all(annotationTasks); // Process all annotations concurrently
            } else if (item.type === "image_file") {
              try {
                console.log(`Fetching image with file ID: ${item.image_file.file_id}`);
                const imageResponse = await fetch(`https://azure2234.openai.azure.com/openai/files/${item.image_file.file_id}/content?api-version=2024-05-01-preview`, {
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
          });
      
          await Promise.all(contentTasks); // Process all content items concurrently
        });
      
        await Promise.all(messageTasks); // Process all messages concurrently
        return { botSecondMessage, botFinalMessage }; // Return the final bot message
      };

      // Build the response object
      const { botSecondMessage, botFinalMessage } = await processMessages();
      console.log("Bot's Second Message:", botSecondMessage);
      console.log("Bot's Final Message:", botFinalMessage);

      // Build the response object
      const response = {
        bot_second_message: botSecondMessage || 'No second message available.',
        bot_final_message: botFinalMessage || 'No final message available.',
      };

      // Add download links if available
      if (downloadLinks.length > 0) {
        response.download_links = downloadLinks;
      }

      // Add image if available
      if (imageBase64) {
        response.image = `data:image/png;base64,${imageBase64}`;
      }

      // Return the response
      if (botSecondMessage || botFinalMessage || downloadLinks.length > 0 || imageBase64) {
        return res.json(response);
      }

      // If no data is available, return a 404 error
      return res.status(404).json({ error: 'No data (message, files, or images) were generated.' });
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