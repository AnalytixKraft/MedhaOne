"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiClient, Party, PartyPayload, PartyType } from "@/lib/api/client";

const partyTypes: PartyType[] = [
  "MANUFACTURER",
  "SUPER_STOCKIST",
  "DISTRIBUTOR",
  "HOSPITAL",
  "PHARMACY",
  "RETAILER",
  "CONSUMER",
];

type FormState = {
  name: string;
  party_type: PartyType;
  phone: string;
  email: string;
  address: string;
  is_active: boolean;
};

const initialState: FormState = {
  name: "",
  party_type: "DISTRIBUTOR",
  phone: "",
  email: "",
  address: "",
  is_active: true,
};

export function PartiesManager() {
  const [items, setItems] = useState<Party[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(initialState);

  const modeLabel = useMemo(
    () => (editingId ? "Update Party" : "Add Party"),
    [editingId],
  );

  const load = async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await apiClient.listParties();
      setItems(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load parties");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const resetForm = () => {
    setForm(initialState);
    setEditingId(null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const payload: PartyPayload = {
      name: form.name,
      party_type: form.party_type,
      phone: form.phone || undefined,
      email: form.email || undefined,
      address: form.address || undefined,
      is_active: form.is_active,
    };

    try {
      if (editingId) {
        await apiClient.updateParty(editingId, payload);
      } else {
        await apiClient.createParty(payload);
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save party");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (item: Party) => {
    setEditingId(item.id);
    setForm({
      name: item.name,
      party_type: item.party_type,
      phone: item.phone ?? "",
      email: item.email ?? "",
      address: item.address ?? "",
      is_active: item.is_active,
    });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[320px,1fr]">
      <Card>
        <CardHeader>
          <CardTitle>{modeLabel}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={handleSubmit}>
            <Input
              data-testid="party-name"
              value={form.name}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, name: event.target.value }))
              }
              placeholder="Party name"
              required
            />

            <select
              value={form.party_type}
              data-testid="party-type"
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  party_type: event.target.value as PartyType,
                }))
              }
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {partyTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>

            <Input
              value={form.phone}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, phone: event.target.value }))
              }
              placeholder="Phone"
            />
            <Input
              value={form.email}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, email: event.target.value }))
              }
              placeholder="Email"
              type="email"
            />
            <Input
              value={form.address}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, address: event.target.value }))
              }
              placeholder="Address"
            />

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    is_active: event.target.checked,
                  }))
                }
              />
              Active
            </label>

            <div className="flex gap-2">
              <Button
                data-testid="create-party"
                type="submit"
                disabled={saving}
              >
                {saving ? "Saving..." : modeLabel}
              </Button>
              {editingId ? (
                <Button type="button" variant="outline" onClick={resetForm}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Parties</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? <p className="mb-3 text-sm text-red-500">{error}</p> : null}
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading parties...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.name}</TableCell>
                    <TableCell>{item.party_type}</TableCell>
                    <TableCell>{item.phone ?? "-"}</TableCell>
                    <TableCell>{item.email ?? "-"}</TableCell>
                    <TableCell>
                      {item.is_active ? "Active" : "Inactive"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleEdit(item)}
                      >
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
