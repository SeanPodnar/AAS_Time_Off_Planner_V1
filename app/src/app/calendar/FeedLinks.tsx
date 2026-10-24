"use client";

import { useActionState } from "react";
import { feedAction, type FeedState } from "./feed-actions";
import type { FeedScope } from "@/lib/calendar/service";

export type FeedItem = { scope: FeedScope; title: string; about: string; createdAt: string | null; lastUsedAt: string | null };

const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));

function Feed({ item }: { item: FeedItem }) {
  const [state, action, pending] = useActionState(feedAction, {} as FeedState);
  const live = item.createdAt !== null && !state.notice;
  return (
    <section className="card" aria-labelledby={`feed-${item.scope}`}>
      <div>
        <h3 id={`feed-${item.scope}`} style={{ margin: 0, fontSize: "1rem" }}>{item.title}</h3>
        <p className="small muted">{item.about}</p>
      </div>
      <p className="small">
        {live
          ? <>Link made {day(item.createdAt!)}. {item.lastUsedAt ? `Last used ${day(item.lastUsedAt)}.` : "Not used yet."}</>
          : "No link yet."}
      </p>
      {state.error && <p className="notice warn" role="alert">{state.error}</p>}
      {state.notice && <p className="notice ok" role="status">{state.notice}</p>}
      {state.address && (
        <div className="stack" role="status">
          <p className="small"><strong>Copy this link now. It won&apos;t be shown again. Anyone with the link can see these dates.</strong></p>
          <div className="field">
            <label htmlFor={`addr-${item.scope}`}>Calendar link</label>
            <input id={`addr-${item.scope}`} className="linkbox" readOnly value={state.address} />
          </div>
          <ul className="tight small">
            <li>Google Calendar: Other calendars, From URL.</li>
            <li>Outlook: Add calendar, Subscribe from web.</li>
            <li>Apple Calendar: File, New Calendar Subscription.</li>
          </ul>
        </div>
      )}
      <form action={action} className="row">
        <input type="hidden" name="scope" value={item.scope} />
        <button className="btn small" type="submit" name="intent" value="reset" disabled={pending}>Get a new link</button>
        {live && <button className="btn small ghost" type="submit" name="intent" value="revoke" disabled={pending}>Turn off</button>}
      </form>
      {live && !state.address && <p className="small muted">Getting a new link turns off the old one.</p>}
    </section>
  );
}

export function FeedLinks({ items }: { items: FeedItem[] }) {
  return (
    <div className="grid">
      {items.map((i) => <Feed key={i.scope} item={i} />)}
    </div>
  );
}
