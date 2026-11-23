const basePort = process.env.PLAYWRIGHT_BASE_PORT ?? "3100";
const unconfiguredPort = Number(basePort);

if (!/^\d+$/.test(basePort) || unconfiguredPort < 1 || unconfiguredPort > 65533) {
  throw new Error("PLAYWRIGHT_BASE_PORT must be a whole number from 1 to 65533.");
}

export const e2eHost = "127.0.0.1";
export const e2ePorts = {
  unconfigured: unconfiguredPort,
  configured: unconfiguredPort + 1,
  provider: unconfiguredPort + 2,
};

export const e2eUrls = {
  unconfigured: `http://${e2eHost}:${e2ePorts.unconfigured}`,
  configured: `http://${e2eHost}:${e2ePorts.configured}`,
  provider: `http://${e2eHost}:${e2ePorts.provider}`,
};
