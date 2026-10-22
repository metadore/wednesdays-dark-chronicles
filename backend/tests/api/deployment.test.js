import { expect } from 'chai';
import request from 'supertest';
import app from '../../src/app.js';

describe('Single-origin deployment site', () => {
  it('serves the site landing page at the root', async () => {
    const response = await request(app).get('/');

    expect(response.status).to.equal(200);
    expect(response.headers['content-type']).to.match(/text\/html/);
    expect(response.text).to.include('THE VOID');
  });

  it('serves the reader configuration from the same origin', async () => {
    const response = await request(app).get('/reader-config.js');

    expect(response.status).to.equal(200);
    expect(response.headers['content-type']).to.match(/javascript/);
    expect(response.text).to.include("var SAME_ORIGIN_API = '/api'");
  });

  it('does not expose backend files', async () => {
    const response = await request(app).get('/backend/.env.example');

    expect(response.status).to.equal(404);
  });
});
