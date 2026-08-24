/**
 * App Bridge web components, declared for TypeScript.
 *
 * App Bridge ships custom elements (`ui-nav-menu`, `ui-modal`, `ui-save-bar`)
 * that are loaded from Shopify's CDN by the script tag in the root layout, not
 * imported as a package. JSX has no idea they exist, so using one is a type
 * error until it is declared here.
 *
 * Kept deliberately loose. These elements take no props we set from React - App
 * Bridge reads their child anchors on mount - so a precise prop type would be
 * fiction. What this file buys is the ability to use them at all, and a single
 * place to add the next one.
 *
 * https://shopify.dev/docs/api/app-home/using-app-bridge
 */

import type React from "react";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "ui-nav-menu": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

export {};
