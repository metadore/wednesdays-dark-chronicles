import { expect } from 'chai';
import request from 'supertest';
import app from '../../src/app.js';

describe('Single-origin deployment site', () => {
  it('serves the site landing page at the root', async () => {
    const response = await request(app).get('/');

    expect(response.status).to.equal(200);
    expect(response.headers['content-type']).to.match(/text\/html/);
    expect(response.text).to.include('THE VOID');

    const nonce = response.text.match(/<script nonce="([^"]+)"/)?.[1];
    const policy = response.headers['content-security-policy'];
    expect(nonce).to.be.a('string').and.not.empty;
    expect(policy).to.include(`'nonce-${nonce}'`);
    expect(policy).to.include('https://cdn.tailwindcss.com');
    expect(policy).to.include('https://fonts.googleapis.com');
    expect(policy).to.include("'unsafe-inline'");
    expect(policy).to.not.match(/script-src[^;]*'unsafe-inline'/);
  });

  it('serves the reader configuration from the same origin', async () => {
    const response = await request(app).get('/reader-config.js');

    expect(response.status).to.equal(200);
    expect(response.headers['content-type']).to.match(/javascript/);
    expect(response.text).to.include("var SAME_ORIGIN_API = '/api'");
  });

  it('adds a fresh CSP nonce to nested HTML pages', async () => {
    const [first, second] = await Promise.all([
      request(app).get('/grim_chronicles/code.html'),
      request(app).get('/grim_chronicles/code.html'),
    ]);

    const firstNonce = first.text.match(/<script nonce="([^"]+)"/)?.[1];
    const secondNonce = second.text.match(/<script nonce="([^"]+)"/)?.[1];

    expect(first.status).to.equal(200);
    expect(second.status).to.equal(200);
    expect(firstNonce).to.be.a('string').and.not.empty;
    expect(secondNonce).to.be.a('string').and.not.empty;
    expect(firstNonce).to.not.equal(secondNonce);
    expect(first.headers['content-security-policy']).to.include(`'nonce-${firstNonce}'`);
    expect(second.headers['content-security-policy']).to.include(`'nonce-${secondNonce}'`);
    expect(first.text).to.not.include('onclick=');
  });

  it('does not expose backend files', async () => {
    const response = await request(app).get('/backend/.env.example');

    expect(response.status).to.equal(404);
  });
});
