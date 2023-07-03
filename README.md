# Expo React Native App with react-native-webview

To read the whole story of this project, please visit my blog post: https://kiss-my-plan.com/blog/20230703-I-built-an-app-wtih-expo-and-webview

## How to run this project

1. Clone this repo
2. Run `npm install`
3. Run `npm run start`

But I think you will be more interested by what you can learn here by checking out the code in `App.js`

As an example:

```js
function App() {
  const onLoadEnd = () => {
    ref.current.injectJavaScript(`window.ENV.PLATFORM_OS = "${Platform.OS}";`);
    setTimeout(() => {
      SplashScreen.hideAsync();
    }, 2000);
  };

  const onPushNotification = (event) => {
    registerForPushNotificationsAsync().then((token) => {
      if (!token) {
        return;
      }
      ref.current.injectJavaScript(`window.onNativePushToken('${JSON.stringify(token)}');`);
    });
  };

  const onMessage = (event) => {
    switch (event.nativeEvent.data) {
      case "request-native-expo-push-permission":
        onPushNotification(event);
        break;
      default:
        break;
    }
  };

  return (
    <WebView
      onLoadEnd={onLoadEnd}
      source={{ uri: APP_URL }}
      onMessage={onMessage}
      injectedJavaScript={initScript}
    />
  );
}
```

Happy coding!
