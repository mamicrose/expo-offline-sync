import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  outExtension({ format }) {
    return {
      js: format === 'cjs' ? '.cjs' : '.js',
    };
  },
  external: [
    'react',
    'react-native',
    'expo-sqlite',
    '@react-native-community/netinfo',
    'expo-background-fetch',
    'expo-task-manager',
  ],
});
