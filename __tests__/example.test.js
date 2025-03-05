const request = require('supertest');
const path = require('path');
const fs = require('fs');
const app = require('../index'); // Assuming your Express app is exported from index.js
let server;

describe('POST /upload-file', function() {
    this.timeout(20000); // Increase timeout to 10 seconds
  
    it('should upload a file and return 200 OK', async () => {
      const { expect } = await import('chai');
      const filePath = path.join(__dirname, 'Financial Sample.xlsx'); // Ensure this file exists
      console.log(`File path: ${filePath}`);
      console.log(`File exists: ${fs.existsSync(filePath)}`);
      const res = await request(app)
      .post('/upload-file')
      .attach('file', filePath); // Ensure this file exists
      expect(res.statusCode).to.equal(200);
      expect(res.body).to.be.an('object');
      expect(res.body).to.have.property('file_id'); // Adjust this based on your actual response
    });
  
    it('should return 400 if no file is uploaded', async () => {
      const { expect } = await import('chai');
      const res = await request(app)
        .post('/upload-file')
        .send();
      expect(res.statusCode).to.equal(400);
      expect(res.body).to.be.an('object');
      expect(res.body.error).to.equal('No file uploaded');
    });
  });
describe('POST /ask', function() {
    this.timeout(10000); // Increase timeout to 10 seconds
  
    it('should return a response for a valid question', async () => {
      const { expect } = await import('chai');
      const res = await request(app)
        .post('/ask')
        .send({ message: 'What is the capital of France?' });
      expect(res.statusCode).to.equal(200);
      expect(res.body).to.be.an('object');
      // Add more assertions based on the expected response
    });
  
    it('should return 400 for a missing question', async () => {
      const { expect } = await import('chai');
      const res = await request(app)
        .post('/ask')
        .send({});
      expect(res.statusCode).to.equal(400);
      expect(res.body).to.be.an('object');
      expect(res.body.error).to.equal('Message body parameter is required');
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) return reject(err);
          resolve();
        });
      });
    }
  });