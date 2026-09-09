"use client";
import { useState, type ReactNode } from "react";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";
import { createTheme, CssBaseline, ThemeProvider } from "@mui/material";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NuqsAdapter } from "nuqs/adapters/next/app";

import { SessionStoresProvider } from "@/cache/session-stores";

const theme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: "#c4b5fd", dark: "#b4a0f0", contrastText: "#0c0d10" },
    background: { default: "#0c0d10", paper: "#14151b" },
    divider: "#30313d",
    text: { primary: "#f0eff6", secondary: "#aeafbf" },
    success: { main: "#80d4a5" },
  },
  typography: {
    fontFamily: "Arial, Helvetica, sans-serif",
    fontSize: 14,
    h4: { fontWeight: 650 },
    button: { textTransform: "none" },
  },
  shape: { borderRadius: 8 },
  components: {
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
    MuiCssBaseline: {
      styleOverrides: { body: { margin: 0 }, "*": { boxSizing: "border-box" } },
    },
  },
});

export default function Providers({ children }: { children: ReactNode }) {
  const [query] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, gcTime: 300_000 },
        },
      }),
  );

  return (
    <AppRouterCacheProvider>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <QueryClientProvider client={query}>
          <SessionStoresProvider>
            <NuqsAdapter>{children}</NuqsAdapter>
          </SessionStoresProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </AppRouterCacheProvider>
  );
}
