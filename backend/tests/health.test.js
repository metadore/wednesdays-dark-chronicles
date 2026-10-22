import supertest from 'supertest';
import { expect } from 'chai';
import app from '../src/app.js';

describe('Health Endpoint', () => {
  it('should return 200 and status ok', async () => {
    const response = await supertest(app).get('/api/health');
    expect(response.status).to.equal(200);
    expect(response.body).to.have.property('status', 'ok');
    expect(response.body).to.have.property('timestamp');
  });

  it('should return 404 for non-existent routes', async () => {
    const response = await supertest(app).get('/api/non-existent');
    expect(response.status).to.equal(404);
  });
});
