import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/")({
  head: () => ({ meta: [{ title: "ACH Admin" }] }),
  beforeLoad: () => {
    throw redirect({ to: "/admin/purchases" });
  },
  component: () => null,
});
