import React from 'react';
import type { User } from 'firebase/auth';
import {
  LogOut,
  MessageSquare,
  Moon,
  PanelLeftClose,
  Plus,
  Sun,
  Trash2,
} from 'lucide-react';
import type { ChatSession } from '../types/chat';

interface SidebarProps {
  user: User;
  chats: ChatSession[];
  activeChatId: string | null;
  isOpenMobile: boolean;
  isCollapsedDesktop: boolean;
  theme: 'light' | 'dark';
  onCloseMobile: () => void;
  onToggleCollapseDesktop: () => void;
  onNewChat: () => void;
  onSelectChat: (chatId: string) => void;
  onDeleteChat: (chatId: string) => void;
  onToggleTheme: () => void;
  onSignOut: () => void;
}

function formatRelativeDate(ms: number): string {
  const diffMin = Math.floor((Date.now() - ms) / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export const Sidebar: React.FC<SidebarProps> = ({
  user,
  chats,
  activeChatId,
  isOpenMobile,
  isCollapsedDesktop,
  theme,
  onCloseMobile,
  onToggleCollapseDesktop,
  onNewChat,
  onSelectChat,
  onDeleteChat,
  onToggleTheme,
  onSignOut,
}) => {
  const initials = (user.displayName || user.email || 'S')
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <>
      {isOpenMobile && (
        <div
          className="fixed inset-0 z-30 bg-black/50 backdrop-blur-[1px] md:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed md:static inset-y-0 left-0 z-40 flex flex-col border-r border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#161b22] transition-all duration-200 ${
          isOpenMobile ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        } ${isCollapsedDesktop ? 'md:w-0 md:overflow-hidden md:border-r-0' : 'w-[272px] shrink-0'}`}
      >
        {/* Top brand bar */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-200/80 dark:border-white/10">
          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src="/logo.png"
              alt="SARTHI AI"
              className="w-8 h-8 rounded-lg object-cover border border-slate-200 dark:border-white/15 shrink-0"
              referrerPolicy="no-referrer"
            />
            <span className="font-display font-bold text-base tracking-tight text-slate-900 dark:text-white whitespace-nowrap truncate">
              SARTHI AI
            </span>
          </div>

          <button
            type="button"
            onClick={() => {
              onCloseMobile();
              onToggleCollapseDesktop();
            }}
            aria-label="Collapse sidebar"
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-white/10 transition-colors cursor-pointer"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        </div>

        {/* New Chat button */}
        <div className="p-3">
          <button
            type="button"
            onClick={() => {
              onNewChat();
              onCloseMobile();
            }}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span>New Chat</span>
          </button>
        </div>

        {/* Chat History List */}
        <div className="flex-1 overflow-y-auto px-3 pb-3">
          <div className="px-2 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
            Recent Chats
          </div>

          {chats.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-slate-500 dark:text-slate-400">
              No saved conversations yet. Start a new chat below.
            </div>
          ) : (
            <ul className="space-y-1">
              {chats.map((chat) => {
                const isActive = chat.id === activeChatId;
                return (
                  <li key={chat.id} className="group relative flex items-center">
                    <button
                      type="button"
                      onClick={() => {
                        onSelectChat(chat.id);
                        onCloseMobile();
                      }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2.5 pr-9 rounded-xl text-left text-sm transition-colors cursor-pointer ${
                        isActive
                          ? 'bg-slate-200/80 dark:bg-white/10 text-slate-900 dark:text-white font-medium'
                          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-white/5'
                      }`}
                    >
                      <MessageSquare className="w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500" />
                      <span className="truncate flex-1">{chat.title}</span>
                      <span className="text-[11px] text-slate-400 tabular-nums shrink-0 group-hover:hidden">
                        {formatRelativeDate(chat.updatedAtMs)}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteChat(chat.id);
                      }}
                      aria-label={`Delete ${chat.title}`}
                      className="absolute right-2 p-1.5 rounded-lg text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-slate-200 dark:hover:bg-white/10 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Bottom Theme & User Profile */}
        <div className="border-t border-slate-200/80 dark:border-white/10 p-3 space-y-2">
          <button
            type="button"
            onClick={onToggleTheme}
            className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-white/5 transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-2.5">
              {theme === 'dark' ? (
                <Sun className="w-4 h-4 text-amber-400" />
              ) : (
                <Moon className="w-4 h-4 text-slate-600" />
              )}
              <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
            </span>
          </button>

          <div className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl bg-white dark:bg-[#0e1117] border border-slate-200/80 dark:border-white/10">
            <div className="flex items-center gap-2.5 min-w-0">
              {user.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={user.displayName || 'User'}
                  className="w-8 h-8 rounded-full object-cover shrink-0"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-blue-600 text-white text-xs font-semibold flex items-center justify-center shrink-0">
                  {initials}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                  {user.displayName || 'SARTHI User'}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {user.email}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onSignOut}
              title="Sign out"
              aria-label="Sign out"
              className="p-2 rounded-lg text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors shrink-0 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};
