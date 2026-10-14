import { test, expect } from "@playwright/test";
import { UsersClient } from "../../support/users-client";

const MAX_NAME = 50;

test.describe("Users API", () => {
  test.describe("Create user", () => {
    test("creates a member by default", { tag: ["@smoke", "@users"] }, async ({ request }) => {
      const users = new UsersClient(request);
      const user = await test.step("When I create a user with only a name", async () => {
        return users.createUser({ name: "Ada" });
      });
      await test.step("Then the user gets the member role", async () => {
        expect(user.role).toBe("member");
        expect(user.id).toBeGreaterThan(0);
      });
    });

    test("creates an admin @users", async ({ request }) => {
      const users = new UsersClient(request);
      const user = await test.step("When I create a user with the admin role", async () => {
        return users.createUser({ name: "Grace", role: "admin" });
      });
      await test.step("Then the role is kept", async () => {
        expect(user.role).toBe("admin");
      });
    });

    const invalid = [
      { reason: "an empty name", name: "" },
      { reason: "a name over the limit", name: "x".repeat(MAX_NAME + 1) },
    ];
    for (const { reason, name } of invalid) {
      test(`rejects ${reason}`, { tag: "@validation" }, async ({ request }) => {
        const users = new UsersClient(request);
        await test.step(`When I create a user with ${reason}`, async () => {
          await users.createUser({ name }, 400);
        });
      });
    }

    test(`accepts a name of exactly ${MAX_NAME} characters`, async ({ request }) => {
      await test.step(`When I post a name of ${MAX_NAME} characters`, async () => {
        const response = await request.post("/api/users", { data: { name: "y".repeat(MAX_NAME) } });
        expect(response.status()).toBe(201);
      });
    });

    test("rejects unicode names", async ({ request }) => {
      test.fixme(true, "Server accepts names with emoji - waiting on validation rules");
      const response = await request.post("/api/users", { data: { name: "🙂" } });
      expect(response.status()).toBe(400);
    });
  });

  test.describe("Read user", () => {
    test("returns a created user", async ({ request }) => {
      const users = new UsersClient(request);
      const created = await test.step("Given a user exists", async () => users.createUser({ name: "Linus" }));
      await test.step("When I fetch it by id", async () => {
        const user = await users.getUser(created.id);
        await test.step("Then the name matches", async () => {
          expect(user.name).toBe("Linus");
        });
      });
    });

    test("returns 404 for an unknown id", async ({ request }) => {
      const users = new UsersClient(request);
      await test.step("When I fetch a user that does not exist", async () => {
        await users.getUser(999999, 404);
      });
    });

    test("lists users", async ({ request }) => {
      const response = await request.get("/api/users");
      expect(response.status()).toBe(200);
      expect(Array.isArray(await response.json())).toBeTruthy();
    });
  });

  test.describe("Delete user", () => {
    test("deletes a user", async ({ request }) => {
      const users = new UsersClient(request);
      const created = await users.createUser({ name: "Temp" });
      await test.step("When I delete the user", async () => {
        await users.deleteUser(created.id);
      });
      await test.step("Then fetching it returns 404", async () => {
        await users.getUser(created.id, 404);
      });
    });
  });

  test.skip("updates a user's role", async ({ request }) => {
    const response = await request.patch("/api/users/1", { data: { role: "admin" } });
    expect(response.ok()).toBeTruthy();
  });
});
