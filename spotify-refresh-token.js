require('dotenv').config();

const http = require('http');
const crypto = require('crypto');
const axios = require('axios');

const clientId = process.env.SPOTIFY_CLIENT_ID || '';
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET || '';
const redirectUri = process.env.SPOTIFY_REDIRECT_URI || 'http://127.0.0.1:8080/callback';
const scope = 'playlist-modify-public playlist-modify-private';

if (!clientId || !clientSecret) {
  console.error('Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET in .env');
  process.exit(1);
}

const redirectUrl = new URL(redirectUri);
const state = crypto.randomBytes(16).toString('hex');

const authUrl = new URL('https://accounts.spotify.com/authorize');
authUrl.searchParams.set('client_id', clientId);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('redirect_uri', redirectUri);
authUrl.searchParams.set('scope', scope);
authUrl.searchParams.set('state', state);

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, redirectUri);
    const code = requestUrl.searchParams.get('code');
    const returnedState = requestUrl.searchParams.get('state');
    const error = requestUrl.searchParams.get('error');

    if (error) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`Spotify returned an error: ${error}`);
      console.error(`Spotify returned an error: ${error}`);
      server.close();
      process.exit(1);
      return;
    }

    if (!code) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Waiting for Spotify callback...');
      return;
    }

    if (returnedState !== state) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('State mismatch. Please try again.');
      console.error('State mismatch. Please try again.');
      server.close();
      process.exit(1);
      return;
    }

    const tokenResponse = await axios.post(
      'https://accounts.spotify.com/api/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }).toString(),
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 15000,
      }
    );

    const refreshToken = tokenResponse.data.refresh_token;
    const accessToken = tokenResponse.data.access_token;

    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Spotify authorization complete. You can close this tab and return to the terminal.');

    console.log('\nSpotify authorization complete.\n');
    console.log(`SPOTIFY_REFRESH_TOKEN=${refreshToken || ''}`);
    console.log(`SPOTIFY_ACCESS_TOKEN=${accessToken || ''}`);
    console.log('\nPut SPOTIFY_REFRESH_TOKEN into Railway variables.');

    server.close(() => process.exit(0));
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Failed to exchange the Spotify code for tokens. Check the terminal.');
    console.error('Failed to exchange Spotify code for tokens:', error.response?.data || error.message);
    server.close(() => process.exit(1));
  }
});

server.listen(Number(redirectUrl.port || 8080), redirectUrl.hostname, () => {
  console.log('Open this URL in your browser and approve Spotify access:\n');
  console.log(authUrl.toString());
  console.log('\nWaiting for Spotify callback...');
});
