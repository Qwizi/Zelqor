"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

function ConversationRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-3 py-3.5 rounded-xl">
      {/* Avatar */}
      <div className="relative shrink-0">
        <Skeleton className="h-10 w-10 rounded-full" />
        {/* Online dot */}
        <Skeleton className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full" />
      </div>
      {/* Name + last message */}
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-2.5 w-8 shrink-0" />
        </div>
        <Skeleton className="h-3 w-44" />
      </div>
    </div>
  );
}

function ChatBubbleSkeleton({ mine }: { mine: boolean }) {
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`flex flex-col gap-1 max-w-[60%] ${mine ? "items-end" : "items-start"}`}>
        {!mine && <Skeleton className="h-2.5 w-16 mx-1" />}
        <Skeleton className={`h-10 rounded-2xl ${mine ? "w-52" : "w-44"}`} />
        <Skeleton className="h-2 w-10 mx-1" />
      </div>
    </div>
  );
}

export function MessagesSkeleton() {
  return (
    <div className="space-y-3 md:space-y-6 -mx-4 md:mx-0 -mt-2 md:mt-0">

      {/* Header */}
      <div className="flex items-center justify-between gap-4 px-4 md:px-0">
        <div className="space-y-1.5">
          <Skeleton className="hidden md:block h-3 w-24" />
          <Skeleton className="h-7 w-36 md:h-12 md:w-52" />
          <Skeleton className="hidden md:block h-3.5 w-40" />
        </div>
        <Skeleton className="hidden md:block h-9 w-24 rounded-full" />
      </div>

      {/* Body */}
      <div className="px-4 md:px-0">

        {/* Mobile: conversation list */}
        <div className="md:hidden space-y-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <ConversationRowSkeleton key={i} />
          ))}
        </div>

        {/* Desktop: two-panel layout */}
        <div className="hidden md:flex gap-6 h-[calc(100vh-16rem)]">

          {/* Left sidebar — conversation list */}
          <Card className="w-80 lg:w-96 shrink-0 flex flex-col overflow-hidden rounded-2xl">
            {/* Sidebar header */}
            <div className="px-5 py-3.5 border-b border-border shrink-0">
              <Skeleton className="h-3 w-20" />
            </div>
            {/* Conversation rows */}
            <div className="flex-1 overflow-y-auto p-2.5 space-y-0.5">
              {Array.from({ length: 6 }).map((_, i) => (
                <ConversationRowSkeleton key={i} />
              ))}
            </div>
          </Card>

          {/* Right — chat area */}
          <Card className="flex-1 flex flex-col overflow-hidden rounded-2xl">
            {/* Chat header */}
            <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border shrink-0">
              <div className="relative shrink-0">
                <Skeleton className="h-10 w-10 rounded-full" />
                <Skeleton className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full" />
              </div>
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>

            {/* Message bubbles */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              <ChatBubbleSkeleton mine={false} />
              <ChatBubbleSkeleton mine={true} />
              <ChatBubbleSkeleton mine={false} />
              <ChatBubbleSkeleton mine={true} />
              <ChatBubbleSkeleton mine={false} />
              <ChatBubbleSkeleton mine={true} />
            </div>

            {/* Input bar */}
            <div className="flex items-center gap-3 px-5 py-3.5 border-t border-border shrink-0">
              <Skeleton className="h-12 flex-1 rounded-xl" />
              <Skeleton className="h-12 w-12 shrink-0 rounded-xl" />
            </div>
          </Card>
        </div>

      </div>
    </div>
  );
}

export default MessagesSkeleton;
