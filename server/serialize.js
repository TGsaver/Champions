import { formatPhone } from './security.js';

export function serializeUser(u) {
  return {
    id: u.id,
    name: u.name,
    phone: u.phone,
    phoneFormatted: formatPhone(u.phone),
    role: u.role,
    passCode: u.pass_code,
    monthlyGoal: u.monthly_goal,
    createdAt: u.created_at,
  };
}

export function serializeVisit(v) {
  return {
    id: v.id,
    kind: v.kind,
    entryType: v.entry_type,
    checkedInAt: v.checked_in_at,
    checkedOutAt: v.checked_out_at,
  };
}

export function serializePayment(p) {
  return {
    id: p.id,
    planId: p.plan_id,
    title: p.plan_title,
    amount: p.amount,
    status: p.status,
    provider: p.provider,
    createdAt: p.created_at,
    paidAt: p.paid_at,
  };
}
