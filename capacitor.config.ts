import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.keychanger.app',
  appName: 'Key Changer',
  webDir: 'dist',
  android: {
    backgroundColor: '#111111',
    // Allow Web Audio API to work when screen is locked / app is backgrounded
    allowMixedContent: false,
  },
  ios: {
    backgroundColor: '#111111',
    // Prevent scroll bounce that makes the piano roll feel wrong
    scrollEnabled: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
    },
  },
};

export default config;
