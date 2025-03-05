const request = require('supertest');
const { expect } = require('chai');
const app = require('../index'); // Assuming your Express app is exported from index.js

describe('GET /', () => {
  it('should return 200 OK', async () => {
    const res = await request(app).get('/');
    expect(res.statusCode).to.equal(200);
    expect(res.body).to.be.an('object'); // Adjust this based on your actual response
  });
});