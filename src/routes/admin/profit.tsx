import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/profit")({
  head: () => ({ meta: [{ title: "Reports & Analytics — ACH Admin" }] }),
  beforeLoad: () => {
    throw redirect({ to: "/admin/reports" });
  },
  component: () => null,
});
