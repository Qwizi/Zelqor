"use client";

import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useChat } from "@/hooks/useChat";
import { useMatchChat } from "@/contexts/MatchContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import { MessageSquare, X } from "lucide-react";

export default function ChatWidget() {
  const { user } = useAuth();
  const { messages: globalMessages, connected: globalConnected, sendMessage: sendGlobal } = useChat();
  const { matchId, matchChatMessages, sendMatchChat } = useMatchChat();
  const [open, setOpen] = useState(false);
  const [unreadGlobal, setUnreadGlobal] = useState(0);
  const [unreadMatch, setUnreadMatch] = useState(0);
  const [activeTab, setActiveTab] = useState("global");

  if (!user) return null;

  const totalUnread = unreadGlobal + unreadMatch;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      {open && (
        <div className="w-80 h-96 bg-background border border-border rounded-lg shadow-xl flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/50">
            <span className="text-sm font-semibold">Chat</span>
            <button
              onClick={() => setOpen(false)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Close chat"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {matchId ? (
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
              <TabsList className="w-full rounded-none border-b">
                <TabsTrigger value="global" className="flex-1 text-xs">
                  Global{" "}
                  {unreadGlobal > 0 && (
                    <span className="ml-1 bg-primary text-primary-foreground rounded-full px-1.5 text-[10px]">
                      {unreadGlobal}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="match" className="flex-1 text-xs">
                  Match{" "}
                  {unreadMatch > 0 && (
                    <span className="ml-1 bg-primary text-primary-foreground rounded-full px-1.5 text-[10px]">
                      {unreadMatch}
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="global" className="flex-1 flex flex-col min-h-0 m-0">
                <MessageList messages={globalMessages} currentUserId={user.id} />
                <ChatInput onSend={sendGlobal} disabled={!globalConnected} />
              </TabsContent>
              <TabsContent value="match" className="flex-1 flex flex-col min-h-0 m-0">
                <MessageList messages={matchChatMessages} currentUserId={user.id} />
                <ChatInput onSend={sendMatchChat} />
              </TabsContent>
            </Tabs>
          ) : (
            <div className="flex-1 flex flex-col min-h-0">
              <MessageList messages={globalMessages} currentUserId={user.id} />
              <ChatInput onSend={sendGlobal} disabled={!globalConnected} />
            </div>
          )}
        </div>
      )}

      <button
        onClick={() => {
          setOpen(!open);
          if (!open) {
            setUnreadGlobal(0);
            setUnreadMatch(0);
          }
        }}
        className="relative h-10 w-10 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:bg-primary/90 transition-colors"
        aria-label={open ? "Close chat" : "Open chat"}
      >
        {open ? <X className="h-5 w-5" /> : <MessageSquare className="h-5 w-5" />}
        {!open && totalUnread > 0 && (
          <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full h-5 w-5 text-[10px] flex items-center justify-center">
            {totalUnread}
          </span>
        )}
      </button>
    </div>
  );
}
