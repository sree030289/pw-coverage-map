import { testAPI, expect } from "../../fixtures";

testAPI.describe("Users through a fixture", () => {
  testAPI("creates a user with the users fixture", { tag: "@users" }, async ({ users }) => {
    const user = await testAPI.step("When I create a user", async () => users.createUser({ name: "Fixture" }));
    await testAPI.step("Then it gets an id", async () => {
      expect(user.id).toBeGreaterThan(0);
    });
  });

  testAPI("reads a missing user", async ({ users }) => {
    testAPI.skip(true, "Parked until ids are stable");
    await users.getUser(424242, 404);
  });
});
