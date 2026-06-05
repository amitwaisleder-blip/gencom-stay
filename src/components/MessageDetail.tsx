import { useMemo, useState } from "react";
import { ChevronLeft, ExternalLink } from "lucide-react";
import type { EmailMessage } from "../models/types";
import { senderDisplay } from "../models/types";
import { behaviorStore } from "../storage/behaviorStore";
import { levelOf } from "../intel/category";
import { Avatar } from "./Avatar";
import { PriorityPill } from "./MessageRow";

const SCALE = [1, 2, 3, 4, 5];

/** Full-screen reading view with a 1–5 importance rating that trains the ranker. */
export function MessageDetail({
  message,
  onClose,
  onRate,
}: {
  message: EmailMessage;
  onClose: () => void;
  onRate: (message: EmailMessage, rating: number) => void;
}) {
  // Pre-select the most recent rating this sender has been given, if any.
  const initial = useMemo(() => {
    const rated = behaviorStore
      .forSender(message.sender?.address ?? "")
      .filter((e) => e.action === "rated" && typeof e.rating === "number");
    return rated.length ? Math.round(rated[rated.length - 1].rating as number) : 0;
  }, [message]);

  const [rating, setRating] = useState(initial);
  const lvl = levelOf(message);

  const choose = (n: number) => {
    setRating(n);
    onRate(message, n);
  };

  const received = new Date(message.receivedDateTime).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  });

  return (
    <div className="detail-overlay">
      <header className="detail-top">
        <button className="detail-back" onClick={onClose}>
          <ChevronLeft size={18} /> Inbox
        </button>
        <PriorityPill level={lvl} />
      </header>

      <div className="detail-scroll">
        <div className="detail-from">
          <Avatar message={message} size={44} />
          <div className="detail-fromtext">
            <span className="detail-sender">{senderDisplay(message)}</span>
            {message.sender && <span className="detail-addr">{message.sender.address}</span>}
          </div>
        </div>

        <h1 className="detail-subject">{message.subject}</h1>
        <p className="detail-time">{received}</p>
        <p className="detail-body">{message.bodyPreview}</p>

        {message.webLink && (
          <a className="detail-open" href={message.webLink} target="_blank" rel="noopener">
            <ExternalLink size={14} /> Open in Outlook
          </a>
        )}
      </div>

      <div className="detail-rate">
        <p className="detail-rate-q">How important is this to you?</p>
        <div className="rate-row">
          {SCALE.map((n) => (
            <button
              key={n}
              className={`rate-btn ${rating >= n ? "on" : ""}`}
              onClick={() => choose(n)}
              aria-label={`Rate ${n} of 5`}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="rate-scale">
          <span>Not important</span>
          <span>Critical</span>
        </div>
        {rating > 0 && (
          <p className="rate-ack">Thanks — Gencom will prioritize {senderDisplay(message)} accordingly.</p>
        )}
      </div>
    </div>
  );
}
