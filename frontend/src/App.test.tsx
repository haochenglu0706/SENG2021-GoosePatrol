import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./context/AuthContext";

test("renders marketing home", () => {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>
  );
  expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  expect(screen.getByText("Start for free")).toBeInTheDocument();
});
