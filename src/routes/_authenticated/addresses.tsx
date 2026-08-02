import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { useState } from "react";
import { Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/addresses")({
  component: AddrPage,
});

function AddrPage() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const [show, setShow] = useState(false);
  const { data: addresses } = useQuery({
    queryKey: ["addresses", user.id],
    queryFn: async () => (await supabase.from("addresses").select("*").eq("user_id", user.id)).data ?? [],
  });
  const add = useMutation({
    mutationFn: async (fd: FormData) => {
      await supabase.from("addresses").insert({
        user_id: user.id,
        full_name: String(fd.get("full_name")),
        phone: String(fd.get("phone")),
        line1: String(fd.get("line1")),
        line2: String(fd.get("line2") || ""),
        city: String(fd.get("city")),
        state: String(fd.get("state")),
        pincode: String(fd.get("pincode")),
      });
    },
    onSuccess: () => { setShow(false); qc.invalidateQueries({ queryKey: ["addresses"] }); },
  });
  const del = useMutation({
    mutationFn: async (id: string) => { await supabase.from("addresses").delete().eq("id", id); },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["addresses"] }),
  });

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-4 font-display text-2xl">Saved addresses</h1>
      <div className="space-y-3">
        {addresses?.map((a) => (
          <Card key={a.id} className="flex items-start justify-between rounded-2xl p-4">
            <div className="text-sm">
              <div className="font-medium">{a.full_name} · {a.phone}</div>
              <div className="text-muted-foreground">{a.line1}{a.line2 ? `, ${a.line2}` : ""}, {a.city}, {a.state} {a.pincode}</div>
            </div>
            <button onClick={() => del.mutate(a.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
          </Card>
        ))}
      </div>
      {show ? (
        <form onSubmit={(e) => { e.preventDefault(); add.mutate(new FormData(e.currentTarget)); }} className="mt-4 grid grid-cols-2 gap-2 rounded-2xl border border-dashed border-border bg-card p-4">
          <div className="col-span-2"><Label>Full name</Label><Input name="full_name" required /></div>
          <div><Label>Phone</Label><Input name="phone" required /></div>
          <div><Label>Pincode</Label><Input name="pincode" required /></div>
          <div className="col-span-2"><Label>Address line 1</Label><Input name="line1" required /></div>
          <div className="col-span-2"><Label>Address line 2</Label><Input name="line2" /></div>
          <div><Label>City</Label><Input name="city" required /></div>
          <div><Label>State</Label><Input name="state" required /></div>
          <div className="col-span-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setShow(false)}>Cancel</Button>
            <Button type="submit" className="rounded-full">Save</Button>
          </div>
        </form>
      ) : (
        <Button variant="outline" className="mt-4 w-full rounded-full" onClick={() => setShow(true)}>+ Add address</Button>
      )}
    </div>
  );
}
