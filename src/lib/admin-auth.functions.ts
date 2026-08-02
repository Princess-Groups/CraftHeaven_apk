import { createServerFn } from "@tanstack/react-start";

export const ADMIN_USER_ID = "ATHIRAMAM";
export const ADMIN_EMAIL = "athiramam@ach.local";

/**
 * Ensures the fixed staff account (user id ATHIRAMAM) exists and has the admin role.
 * Idempotent: safe to call before every admin sign-in attempt.
 */
export const ensureAdminAccount = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const password = process.env.ADMIN_SEED_PASSWORD || "Athira@2003";

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
