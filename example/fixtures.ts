import { test as base, expect } from "@playwright/test";
import { UsersClient } from "./support/users-client";

// A fixture-extended test with a custom name, as many suites do.
export const testAPI = base.extend<{ users: UsersClient }>({
  users: async ({ request }, use) => {
    await use(new UsersClient(request));
  },
});
export { expect };
