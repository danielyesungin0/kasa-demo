module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      "nativewind/babel",
    ],
    // Reanimated 4 uses the worklets plugin (split out of reanimated); LAST.
    plugins: ["react-native-worklets/plugin"],
  };
};
