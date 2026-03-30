"use client";

import { AppProvider } from "@shopify/polaris";
import en from "@shopify/polaris/locales/en.json";

type PolarisProviderProps = {
  children: React.ReactNode;
};

export function PolarisProvider({ children }: PolarisProviderProps) {
  return <AppProvider i18n={en}>{children}</AppProvider>;
}
