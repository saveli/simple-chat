import React, { FC, useEffect, useRef } from "react";
import { Box } from "@mui/material";
import ChatMessage from "./ChatMessage";
import { Message } from "../types";

interface ChatContainerProps {
  messages: Message[];
  setIsTypingFalse: any;
  userLabel?: string;
  assistantLabel?: string;
}

const ChatContainer: FC<ChatContainerProps> = ({
  messages,
  setIsTypingFalse,
  userLabel = "You",
  assistantLabel = "Assistant"
}) => {
  const messagesContainerRef = useRef<null | HTMLDivElement>(null);

  useEffect(() => {
    if (messagesContainerRef.current) {
      const { scrollHeight } = messagesContainerRef.current;
      messagesContainerRef.current.scrollTop = scrollHeight;
    }
    // console.log("messages", messages);
  }, [messages]);

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "80vh",
        p: 2,
        overflow: "auto"
      }}
    >
      <Box
        ref={messagesContainerRef}
        sx={{
          flexGrow: 1,
          width: "100%",
          overflow: "auto",
          display: "flex",
          flexDirection: "column"
        }}
      >
        {messages.map((message, index) => (
          <ChatMessage
            key={index}
            content={message.content}
            type={message.type}
            role={message.role}
            setIsTypingFalse={setIsTypingFalse}
            userLabel={userLabel}
            assistantLabel={assistantLabel}
          />
        ))}
      </Box>
    </Box>
  );
};

export default ChatContainer;
