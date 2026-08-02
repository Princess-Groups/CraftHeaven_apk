import { createServerFn } from "@tanstack/react-start";

export const ADMIN_USER_ID = "ATHIRAMAM";
export const ADMIN_EMAIL = "athiramam@ach.local";

// The main admin password used to authorize creating new admin accounts.
// Only the store owner knows this — it gates the "Create Admin" flow.
// Set the real value as ADMIN_MASTER_PASSWORD env var on the server (Vercel).
const MASTER_PASSWORD = process.env.ADMIN_MASTER_PASSWORD || "";

/**
 * Ensures the fixed staff account (user id ATHIRAMAM) exists and has the admin role.
 * Idempotent: safe to call before every admin sign-in attempt.
 */
export const ensureAdminAccount = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const password = process.env.ADMIN_SEED_PASSWORD || "";

  // Find existing user by email
  let userId: string | null = null;
  for (let page = 1; page <= 10 && !userId; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = data.users.find((u) => u.email?.toLowerCase() === ADMIN_EMAIL);
    if (found) userId = found.id;
    if (data.users.length < 200) break;
  }

  if (!userId) {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: ADMIN_EMAIL,
      password,
      email_confirm: true,
      user_metadata: { full_name: "Athira Mam", username: ADMIN_USER_ID },
    });
    if (error) throw error;
    userId = data.user?.id ?? null;
  } else {
    // keep the password in sync with the configured one
    await supabaseAdmin.auth.admin.updateUserById(userId, { password, email_confirm: true });
  }

  if (!userId) throw new Error("Could not provision admin account");

  await supabaseAdmin.from("user_roles").upsert(
    { user_id: userId, role: "admin" },
    { onConflict: "user_id,role", ignoreDuplicates: true },
  );

  return { ok: true as const };
});

type CreateAdminInput = { email: string; username: string; password: string; masterPassword: string };

/**
 * Creates a NEW admin account. Gated by the main admin password so only the
 * store owner can add admins.
 * Returns { ok } on success or throws with a user-friendly message.
 */
export const createAdminAccount = createServerFn({ method: "POST" })
  .validator((d: CreateAdminInput) => d)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = (data.email || "").trim().toLowerCase();
    const username = (data.username || "").trim().toUpperCase();
    const password = data.password || "";

    if (data.masterPassword !== MASTER_PASSWORD) {
      throw new Error("Incorrect main admin password");
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new Error("Enter a valid email address");
    }
    if (password.length < 6) {
      throw new Error("Password must be at least 6 characters");
    }

    // If the user already exists, update their password + ensure admin role;
    // otherwise create them.
    let userId: string | null = null;
    for (let page = 1; page <= 10 && !userId; page++) {
      const { data: res, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw error;
      const found = res.users.find((u) => u.email?.toLowerCase() === email);
      if (found) userId = found.id;
      if (res.users.length < 200) break;
    }

    if (!userId) {
      const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: username, username },
      });
      if (error) throw error;
      userId = created.user?.id ?? null;
    } else {
      await supabaseAdmin.auth.admin.updateUserById(userId, { password, email_confirm: true });
    }

    if (!userId) throw new Error("Could not create admin account");

    await supabaseAdmin.from("user_roles").upsert(
      { user_id: userId, role: "admin" },
      { onConflict: "user_id,role", ignoreDuplicates: true },
    );

    return { ok: true as const, userId };
  },
);
