/**
 * Custom Expo config plugin to fix minSdkVersion = 24 for react-native-webrtc.
 * 
 * EAS builds the app using managed workflow prebuild — the android/app/src/main/AndroidManifest.xml
 * gets generated from app.json. But Expo SDK 51 still generates minSdkVersion=23 in the manifest.
 * 
 * This plugin adds tools:overrideLibrary to suppress the merge conflict from react-native-webrtc@124
 * which requires minSdk >= 24, AND sets minSdkVersion correctly in build.gradle.
 */
const {
  withAndroidManifest,
  withAppBuildGradle,
} = require('@expo/config-plugins');

// Step 1: Force minSdkVersion=24 in app/build.gradle
const withMinSdkGradle = (config) => {
  return withAppBuildGradle(config, (config) => {
    let contents = config.modResults.contents;
    
    // Replace existing minSdkVersion declarations
    contents = contents.replace(
      /minSdkVersion\s*[=:]?\s*\d+/g,
      'minSdkVersion = 24'
    );
    
    config.modResults.contents = contents;
    return config;
  });
};

// Step 2: Add tools:overrideLibrary to AndroidManifest.xml to allow minSdk mismatch
const withMinSdkManifest = (config) => {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;
    const mainApplication = manifest.manifest;

    // Ensure the tools namespace is declared
    if (!mainApplication.$['xmlns:tools']) {
      mainApplication.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }

    // Find or create uses-sdk element
    if (!mainApplication['uses-sdk']) {
      mainApplication['uses-sdk'] = [{}];
    }

    const usesSdk = mainApplication['uses-sdk'][0];
    usesSdk.$= usesSdk.$ || {};
    usesSdk.$['android:minSdkVersion'] = '24';
    // Override the library restriction
    usesSdk.$['tools:overrideLibrary'] = 'com.oney.WebRTCModule, com.zxcpoiu.incallmanager';

    return config;
  });
};

const withAndroidMinSdk = (config) => {
  config = withMinSdkGradle(config);
  config = withMinSdkManifest(config);
  return config;
};

module.exports = withAndroidMinSdk;
