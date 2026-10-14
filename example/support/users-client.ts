import { APIRequestContext, expect } from "@playwright/test";

// A typical API client: each method takes the HTTP status it expects as its last argument.
export class UsersClient {
  constructor(private readonly request: APIRequestContext) {}

  async createUser(body: { name: string; role?: string }, expectedStatus = 201) {
    const response = await this.request.post("/api/users", { data: body });
    expect(response.status()).toBe(expectedStatus);
    return response.json();
  }

  async getUser(id: number, expectedStatus = 200) {
    const response = await this.request.get(`/api/users/${id}`);
    expect(response.status()).toBe(expectedStatus);
    return response.json();
  }

  async deleteUser(id: number, expectedStatus = 204) {
    const response = await this.request.delete(`/api/users/${id}`);
    expect(response.status()).toBe(expectedStatus);
  }
}
