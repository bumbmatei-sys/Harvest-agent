import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.harvest.app',
  appName: 'Harvest',
  webDir: 'out',
  server: {
    url: 'https://theharvest.app',
    cleartext: false,
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#0b1121',
      showSpinner: false,
    },
    StatusBar: {
      style: 'dark',
      backgroundColor: '#0b1121',
    },
  },
};

export default config;
