import {defineConfig} from 'vite';import react from '@vitejs/plugin-react';import tailwind from '@tailwindcss/vite';
export default defineConfig({plugins:[react(),tailwind()],server:{proxy:{'/api':'http://127.0.0.1:3600','/auth/google':'http://127.0.0.1:3600'}},build:{sourcemap:false}});
