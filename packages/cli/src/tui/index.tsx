import React from "react";
import { render } from "ink";
import { App } from "./components/App.js";

export async function startTui(): Promise<void> {
  const { waitUntilExit } = render(<App />);
  await waitUntilExit();
}
