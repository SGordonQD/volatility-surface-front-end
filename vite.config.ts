import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        cryptoOptionsVolatilitySurface: resolve(
          __dirname,
          'crypto-options-volatility-surface/index.html',
        ),
        explainer: resolve(__dirname, 'explainer/index.html'),
        whatIsSvi: resolve(__dirname, 'what-is-svi/index.html'),
        methodology: resolve(__dirname, 'methodology/index.html'),
        arbitrageConstraints: resolve(
          __dirname,
          'arbitrage-constraints/index.html',
        ),
        awsArchitecture: resolve(__dirname, 'aws-architecture/index.html'),
        kafkaKubernetesRoadmap: resolve(
          __dirname,
          'kafka-kubernetes-roadmap/index.html',
        ),
        realTimeVolatilitySurface: resolve(
          __dirname,
          'real-time-volatility-surface/index.html',
        ),
      },
    },
  },
})
