# Android TV / Google TV / Fire TV

The Android package is shared with phones. Expo prebuild injects both phone and Leanback launcher categories and marks touchscreen/Leanback as optional. Touch gestures remain enabled on phones and are disabled on TV devices. D-pad focus uses the existing focusable React Native controls with cyan focus treatment; player remote events reveal controls, switch live channels or seek VOD while hidden, and BACK hides visible controls before exiting.
