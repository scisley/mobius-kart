import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';

// `npm run dev:phone` serves over HTTPS with a self-signed certificate: phone browsers only
// expose the motion sensors (tilt steering, bounce-to-thump) to secure pages.
export default defineConfig(({ mode }) => ({
  plugins: mode === 'phone' ? [basicSsl()] : [],
}));
