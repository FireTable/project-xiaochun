import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { vrmEngine } from '@/core/vrmEngine';
import { Send, Sparkles } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export const ChatBar: React.FC = () => {
  const { t } = useTranslation();
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || isSending) return;

    setInputText('');
    setIsSending(true);

    try {
      await vrmEngine.sendMessage(text);
    } catch (e) {
      console.error(e);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <div className="fixed bottom-[calc(0.75rem+env(safe-area-inset-bottom,0px))] sm:bottom-8 left-1/2 -translate-x-1/2 z-30 w-full max-w-xl px-3 sm:px-4 pointer-events-auto">
      {/* ponytail: 输入框 h-10(40px)全端通用,字号 text-base 16px 防止 iOS 聚焦自动缩放;
          发送按钮 h-11(44px)略高于输入,符合"主 CTA 高于输入"惯例。 */}
      <div className="flex items-center gap-2 sm:gap-2.5 p-1.5 sm:p-2 rounded-full bg-slate-950/85 border border-white/20 shadow-2xl backdrop-blur-2xl ring-1 ring-black/40">
        <Input
          type="text"
          id="chatText"
          placeholder={t('chat.placeholder')}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          disabled={isSending}
          className="border-none bg-transparent shadow-none focus-visible:ring-0 focus-visible:border-none text-white placeholder:text-slate-400 text-base sm:text-sm h-10 px-3 touch-manipulation"
        />
        <Button
          id="chatSend"
          variant="default"
          size="default"
          onClick={() => void handleSend()}
          disabled={isSending || !inputText.trim()}
          className="shrink-0 h-11 sm:h-9 px-4 text-sm sm:text-xs"
        >
          {isSending ? (
            <>
              <Sparkles className="w-4 h-4 sm:w-3.5 sm:h-3.5 animate-spin text-brand-100" />
              <span>{t('chat.sending')}</span>
            </>
          ) : (
            <>
              <Send className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
              <span>{t('chat.send')}</span>
            </>
          )}
        </Button>
      </div>
    </div>
  );
};
