interface BrowserLaunchOptions {
  args: string[];
  ignoreHTTPSErrors?: boolean;
}

export function buildBrowserLaunchOptions(opts: {
  launcher: 'chromium' | 'firefox';
  ignoreHttpsErrors?: boolean;
}): BrowserLaunchOptions {
  const args: string[] = [];

  if (opts.launcher === 'chromium') {
    args.push('--disable-gpu', '--disable-blink-features=AutomationControlled');
  }
  if (process.env.MARKDOWNEE_NO_SANDBOX) {
    args.push('--no-sandbox');
  }

  const options: BrowserLaunchOptions = { args };
  if (opts.ignoreHttpsErrors) options.ignoreHTTPSErrors = true;
  return options;
}
