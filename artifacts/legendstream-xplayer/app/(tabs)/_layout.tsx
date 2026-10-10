import React from 'react';
import { Stack } from 'expo-router';
import { UiPresentationProvider } from '@/context/UiPresentationContext';

export default function TabLayout() {
  return (
    <UiPresentationProvider>
      <Stack screenOptions={{ headerShown: false, animation: 'fade' }} />
    </UiPresentationProvider>
  );
}
