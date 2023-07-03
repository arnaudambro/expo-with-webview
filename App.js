import { StyleSheet, Platform, Linking, Alert, BackHandler } from "react-native";
import { WebView } from "react-native-webview";
import { registerForPushNotificationsAsync } from "./services/expo-push-notifs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import * as SplashScreen from "expo-splash-screen";
import * as Location from "expo-location";
import * as Contacts from "expo-contacts";
import * as DeepLinking from "expo-linking";
import * as Clipboard from "expo-clipboard";
import AsyncStorage from "@react-native-async-storage/async-storage";

const APP_URL = __DEV__ ? "http://192.168.178.49:3617" : "https://kiss-my-plan.com";

SplashScreen.preventAutoHideAsync();

const initScript = `window.ENV.APP_PLATFORM = "native";`;
function App() {
  const deepLink = DeepLinking.useURL();
  const receivedUrl = deepLink?.includes("kiss-my-plan.com") ? deepLink : APP_URL;
  const { path } = DeepLinking.parse(receivedUrl);
  const url = `${APP_URL}/${path || "plans"}`;

  const ref = useRef(null);

  const onLoadEnd = () => {
    ref.current.injectJavaScript(`window.ENV.PLATFORM_OS = "${Platform.OS}";`);
    setTimeout(() => {
      SplashScreen.hideAsync();
    }, 2000);
  };

  const onPushNotification = (event) => {
    const requestPush = event.nativeEvent.data === "request-native-push-permission";
    const requestExpoPush = event.nativeEvent.data === "request-native-expo-push-permission";
    // const readToken = event.nativeEvent.data === "request-native-get-token-if-exists";
    const readExpoToken = event.nativeEvent.data === "request-native-get-expo-token";
    registerForPushNotificationsAsync({
      force: requestPush || requestExpoPush,
      expo: readExpoToken || requestExpoPush,
    }).then((token) => {
      if (!token) {
        return;
      }
      ref.current.injectJavaScript(`window.onNativePushToken('${JSON.stringify(token)}');`);
    });
  };

  const onRequestLocation = (event) => {
    const eventName = event.nativeEvent.data;
    Location.requestForegroundPermissionsAsync().then(async ({ status }) => {
      if (status !== "granted") {
        if (eventName === "request-native-force-current-position") {
          Alert.alert(
            "Permission not granted to access your location",
            "You can change that in your settings",
            [
              { text: "Open Settings", onPress: () => Linking.openSettings() },
              { text: "OK", style: "cancel", onPress: () => {} },
            ]
          );
        }
        const centerOfTheWorld = { coords: { latitude: 0, longitude: 0 } };
        ref.current.injectJavaScript(
          `window.onGetCurrentPosition('${JSON.stringify(centerOfTheWorld)}');`
        );
        ref.current.injectJavaScript(`window.onUnZoom();`);
        return null;
      }
      const location = await Location.getCurrentPositionAsync({});
      ref.current.injectJavaScript(`window.onGetCurrentPosition('${JSON.stringify(location)}');`);
    });
  };

  const onRequestContacts = async () => {
    if (Platform.OS === "android") {
      const permission = await Contacts.getPermissionsAsync();
      if (!permission.granted) {
        if (AsyncStorage.getItem("contactsPermission") === "never") return;
        if (!permission.canAskAgain) return;
        const prominentPermission = await new Promise((resolve) => {
          Alert.alert(
            "Kiss My Plan wants to access your contacts",
            "In order to see if your contacts already use Kiss My Plan, or if you want to invite any of them, we need to access your contacts.",
            [
              {
                text: "Not yet",
                onPress: () => resolve(false),
                style: "cancel",
              },
              // {
              //   text: "Never ask again",
              //   onPress: () => {
              //     AsyncStorage.setItem("contactsPermission", "never");
              //     resolve(false);
              //   },
              //   style: "destructive",
              // },
              {
                text: "OK",
                onPress: () => resolve(true),
              },
            ]
          );
        });
        if (!prominentPermission) return;
      }
    }
    Contacts.requestPermissionsAsync()
      .then(async ({ status }) => {
        if (status === "granted") {
          return Contacts.getContactsAsync({
            fields: [
              Contacts.Fields.Emails,
              Contacts.Fields.FirstName,
              Contacts.Fields.LastName,
              Contacts.Fields.PhoneNumbers,
            ],
          });
        } else {
          Alert.alert(
            "Permission not granted to access contacts",
            "You can change that in your settings",
            [
              { text: "Open Settings", onPress: () => Linking.openSettings() },
              { text: "OK", style: "cancel", onPress: () => {} },
            ]
          );
        }
        return { data: [] };
      })
      .then(({ data }) => {
        const emailRegex = new RegExp("^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+.[a-zA-Z0-9-.]+$");
        const phoneRegex = new RegExp("^[0-9+ ]+$");
        function normalizeName(name) {
          // Replacing all accented characters with their normal counterparts
          const normalized = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          // Removing anything that's not a letter or space
          const cleaned = normalized.replace(/[^a-zA-Z\s]/g, " ");
          // Converting to lower case
          const lowercased = cleaned.toLowerCase();
          // Removing leading and trailing spaces
          const trimmed = lowercased.trim();
          // Replacing multiple spaces with a single space
          const finalName = trimmed.replace(/\s+/g, " ");
          return finalName;
        }
        const properData = data.reduce((flattenedAndValidatedData, contact) => {
          if (!contact?.phoneNumbers?.length && !contact?.emails?.length) {
            return flattenedAndValidatedData;
          }
          const name = contact?.name?.replace(/'/g, " ");
          // keep only letters for search, and replace special characters with proper letters
          if (!contact?.name) {
            return flattenedAndValidatedData;
          }
          const forSearch = normalizeName(contact?.name);
          const { phoneNumbers = [], emails = [] } = contact;
          const newContacts = [];
          const userPhoneNumbers = [];
          for (const phone of phoneNumbers) {
            // validate phone number with regex : it can have numbers and '+' and spaces only
            let number = phone.digits;
            if (!number) {
              number = phone.number.replace(/[^0-9+]/g, "");
            }
            if (!phoneRegex.test(number)) {
              continue;
            }
            userPhoneNumbers.push(number);
          }
          if (!emails.length) {
            newContacts.push({
              name,
              forSearch,
              email: "",
              phoneNumbers: userPhoneNumbers,
            });
            return [...flattenedAndValidatedData, ...newContacts];
          }
          for (const email of emails) {
            // validate email with regex
            if (!emailRegex.test(email.email)) {
              continue;
            }
            newContacts.push({
              name,
              forSearch,
              email: email.email,
              phoneNumbers: userPhoneNumbers,
            });
          }
          return [...flattenedAndValidatedData, ...newContacts];
        }, []);
        ref.current.injectJavaScript(`window.onGetContacts('${JSON.stringify(properData)}');`);
      });
  };

  const [urlFromClipboard, setUrlFromClipboard] = useState(null);
  const onRequestClipboardTextContent = async (event) => {
    if (event.nativeEvent.data === "request-native-clipboard-text-content-on-first-opening") {
      const numberOfOpenings = await AsyncStorage.getItem("@numberOfOpenings");
      if (Number(numberOfOpenings) > 1) {
        ref.current.injectJavaScript(
          `window.onGetClipboardTextContent('numberOfOpenings: ${numberOfOpenings}');`
        );
        SplashScreen.hideAsync();
        return;
      }
      const prominentPermission = await new Promise((resolve) => {
        Alert.alert(
          "It's your first time on Kiss My Plan, can we check your Clipboard if you were invited by one of your friends?",
          "We need to access your clipboard, it will load the link you clicked on, and if it's a Kiss My Plan link, we will check if you were invited by one of your friends to add him/her to your friends on Kiss My Plan.",
          [
            {
              text: "Not yet",
              onPress: () => resolve(false),
              style: "cancel",
            },
            {
              text: "OK",
              onPress: () => resolve(true),
            },
          ]
        );
      });
      if (!prominentPermission) return;
    }
    const text = await Clipboard.getStringAsync();
    if (!text.startsWith(APP_URL)) {
      // ref.current.injectJavaScript(
      //   `window.onGetClipboardTextContent('text.startsWith(APP_URL): ${text}');`
      // );
      SplashScreen.hideAsync();
      return;
    }
    setUrlFromClipboard(text);
    ref.current.injectJavaScript(`window.onGetClipboardTextContent('${text}');`);
    setTimeout(() => {
      SplashScreen.hideAsync();
    }, 1500);
  };

  const source = useMemo(
    () => ({
      uri: urlFromClipboard ?? url,
    }),
    [url, urlFromClipboard]
  );

  const onAndroidBackPress = () => {
    if (ref.current) {
      ref.current.goBack();
      return true; // prevent default behavior (exit app)
    }
    return false;
  };

  useEffect(() => {
    if (Platform.OS === "android") {
      BackHandler.addEventListener("hardwareBackPress", onAndroidBackPress);
      return () => {
        BackHandler.removeEventListener("hardwareBackPress", onAndroidBackPress);
      };
    }
  }, []);

  useEffect(() => {
    AsyncStorage.getItem("@numberOfOpenings").then((numberOfOpenings) => {
      AsyncStorage.setItem("@numberOfOpenings", `${(Number(numberOfOpenings) ?? 0) + 1}`);
    });
  }, []);

  const [backgroundColor, setBackgroundColor] = useState("#fff");
  const insets = useSafeAreaInsets();

  const style = useMemo(
    () => ({
      flex: 1,
      backgroundColor,
    }),
    [backgroundColor]
  );

  const onMessage = useCallback(
    (event) => {
      switch (event.nativeEvent.data) {
        case "request-native-set-safe-background-black":
          setBackgroundColor("#000");
          break;
        case "request-native-set-safe-background-white":
          setBackgroundColor("#fff");
          break;
        case "request-native-get-inset-bottom-height":
          ref.current.injectJavaScript(`window.onGetInsetBottomHeight('${insets.bottom}');`);
          break;
        case "request-native-get-contacts":
          onRequestContacts();
          break;
        case "request-native-clipboard-text-content":
        case "request-native-clipboard-text-content-on-first-opening":
          onRequestClipboardTextContent(event);
          break;
        case "request-native-get-current-position":
        case "request-native-force-current-position":
          onRequestLocation(event);
          break;
        case "request-native-push-permission":
        case "request-native-expo-push-permission":
        case "request-native-get-token-if-exists":
        case "request-native-get-expo-token":
          onPushNotification(event);
          break;
        default:
          break;
      }
    },
    [
      setBackgroundColor,
      onRequestContacts,
      onRequestClipboardTextContent,
      onRequestLocation,
      onPushNotification,
      insets,
    ]
  );

  return (
    <SafeAreaProvider>
      <SafeAreaView style={style} edges={["left", "right", "top"]}>
        <WebView
          ref={ref}
          style={styles.container}
          startInLoadingState
          onLoadEnd={onLoadEnd}
          source={source}
          pullToRefreshEnabled
          allowsBackForwardNavigationGestures
          // onNavigationStateChange={onNavigationStateChange}
          onMessage={onMessage}
          injectedJavaScript={initScript}
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

export default function () {
  return (
    <SafeAreaProvider>
      <App />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeContainer: {
    flex: 1,
    backgroundColor: "#000",
    // backgroundColor: "transparent",
  },
  container: {
    flex: 1,
    // backgroundColor: "#000",
  },
});
