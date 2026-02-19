import React, { useState, useRef, ChangeEvent, FormEvent, useEffect, useCallback } from "react";
import ChatContainer from "./ChatContainer";
import ChatInputForm from "./ChatInputForm";
import { Box, Button, Typography } from "@mui/material";
import { Message } from "../types";
import BlinkingDots from "./BlinkingDots";
import { socket } from "../socket";

const ChatPage: React.FC = () => {
  const [sessionId, setSessionId] = useState("");
  const [participantId, setParticipantId] = useState("");
  const [messages, setMessages] = useState([]);

  const [newMessage, setNewMessage] = useState<string>("");
  const [isTyping, setIsTyping] = useState<boolean>(true);
  const [imageFile, setImageFile] = useState(null);

  const [urlParams, setUrlParams] = useState<{ [key: string]: any }>({});
  const [projectInfo, setProjectInfo] = useState(null);
  const [scenarioInfo, setScenarioInfo] = useState<any>(null);

  // LimeSurvey integration state
  const [chatEnded, setChatEnded] = useState<boolean>(false);
  const chatEndedRef = useRef<boolean>(false); // synchronous guard against multiple endChat calls
  const [chatStartTime, setChatStartTime] = useState<number | null>(null);
  const [minTimeReached, setMinTimeReached] = useState<boolean>(false);
  const maxTimeTimerRef = useRef<NodeJS.Timeout | null>(null);
  const minTimeTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Derived: is this in LimeSurvey iframe mode?
  const isLimeSurvey = urlParams.limesurvey === "1" || urlParams.limesurvey === "true";

  // Fetch scenario info from aLLMa
  const fetchScenarioInfo = async (participantId: string) => {
    try {
      const allmaUrl = window.location.origin;
      const response = await fetch(`${allmaUrl}/v1/session/${participantId}/info`);
      if (response.ok) {
        const data = await response.json();
        console.log("Scenario info:", data);
        if (data.exists) {
          setScenarioInfo(data);
        }
      }
    } catch (e) {
      console.log("Could not fetch scenario info:", e);
    }
  };

  // Initialize session and get scenario (before any messages)
  const initializeSession = async (participantId: string, debug: boolean = false) => {
    try {
      const allmaUrl = window.location.origin;
      const round = parseInt(urlParams.round || "1");
      // Send a special init request to create the session
      const initBody: any = { participant_id: participantId, debug: debug, round: round };
      const maxTime = parseInt(urlParams.max_time || "0");
      const maxMessages = parseInt(urlParams.max_messages || "0");
      if (maxTime > 0) initBody.max_time = maxTime;
      if (maxMessages > 0) initBody.max_messages = maxMessages;
      const response = await fetch(`${allmaUrl}/v1/session/${participantId}/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(initBody)
      });
      if (response.ok) {
        const data = await response.json();
        console.log("Session initialized:", data);
        if (data.scenario_title) {
          setScenarioInfo(data);
        }
        // If AI should speak first, add the opening message
        if (data.ai_speaks_first && data.opening_message) {
          setMessages(prev => [...prev, {
            role: "assistant",
            content: data.opening_message,
            type: "text",
            timestamp: new Date().toISOString()
          }]);
        }
      }
    } catch (e) {
      console.log("Could not initialize session:", e);
    }
  };

  // End chat handler (idempotent) — chatEndedRef gives synchronous protection
  // because React state updates are async and may fire multiple times per render cycle
  const endChat = useCallback(async (reason: string) => {
    if (chatEndedRef.current) return;
    chatEndedRef.current = true;
    setChatEnded(true);

    // Clear timers
    if (maxTimeTimerRef.current) clearTimeout(maxTimeTimerRef.current);
    if (minTimeTimerRef.current) clearTimeout(minTimeTimerRef.current);

    // Add system message locally
    setMessages(prev => [...prev, {
      role: "system",
      content: "The chat session has ended.",
      type: "text",
      timestamp: new Date().toISOString()
    }]);

    const durationSeconds = chatStartTime
      ? Math.round((Date.now() - chatStartTime) / 1000)
      : 0;

    // Notify simple-chat backend
    socket.emit("chat_ended", {
      session_id: sessionId,
      participant_id: participantId,
      reason: reason,
      message_count: messages.length,
      duration_seconds: durationSeconds
    });

    // Notify aLLMa wrapper to persist interaction log
    try {
      const allmaUrl = window.location.origin;
      const pid = urlParams.participant_id || participantId;
      const round = parseInt(urlParams.round || "1");
      await fetch(`${allmaUrl}/v1/session/${pid}/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, round })
      });
    } catch (e) {
      console.log("Could not notify aLLMa of session end:", e);
    }

    // Notify parent frame (LimeSurvey)
    if (isLimeSurvey) {
      window.parent.postMessage({
        type: "simple-chat-event",
        event: "chat_completed",
        data: {
          conversation_id: sessionId,
          participant_id: participantId,
          message_count: messages.length,
          duration_seconds: durationSeconds,
          reason: reason
        }
      }, "*");
    }
  }, [chatStartTime, sessionId, participantId, messages.length, urlParams, isLimeSurvey]);

  const handleContinueClick = () => {
    window.parent.postMessage({
      type: "simple-chat-event",
      event: "continue_clicked"
    }, "*");
  };

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    let params: { [key: string]: any } = {};
    for (let [key, value] of searchParams) {
      params[key] = value;
    }
    console.log("url param info: ", params);
    setUrlParams(params);
  }, []);

  useEffect(() => {
    if (!urlParams.pid) return;
    socket.emit("fetch_project_info", { project_id: urlParams.pid });
  }, [urlParams.pid]);

  const sending_initial_message = async sessionId => {
    const location = window.location;
    const searchParams = new URLSearchParams(location.search);
    let params: { [key: string]: any } = {};
    for (let pair of searchParams) {
      const [key, value] = pair;
      params[key] = value;
    }

    // pid is project_id
    if ("pid" in params) {
      await socket.emit("initial_message_to_server", {
        data: params,
        session_id: sessionId
      });
    } else {
      alert("PID is not set.");
      console.log("pid is not set. params: ", params);
      setIsTyping(true);
    }
  };

  useEffect(() => {
    socket.connect();

    socket.on("connect", () => {
      console.log("socket connect is called");
    });

    socket.on("session_id", async data => {
      console.log("session_id event: ", data);
      setIsTyping(false); // user can send message after getting the session id.
      setSessionId(data.session_id);
      await sending_initial_message(data.session_id);

      // Start chat timers
      setChatStartTime(Date.now());
    });

    socket.on("set_participant_id", data => {
      console.log("set_participant_id event: ", data);
      setParticipantId(data.participant_id);
    });

    socket.on("message_to_client", data => {
      if (data.type === "message") {
        setIsTyping(true);
        setMessages(prevMessages => [...prevMessages, data.data]);
      } else if (data.type === "stream") {
        setMessages(prevMessages => {
          let updatedMessages = [...prevMessages];
          const lastMessage = updatedMessages[updatedMessages.length - 1];
          if (lastMessage) {
            updatedMessages[updatedMessages.length - 1] = {
              ...lastMessage,
              content: (lastMessage.content || "") + data.data.content
            };
          }
          return updatedMessages;
        });
      }
    });

    socket.on("pid_not_found", async data => {
      if (data.message.includes("deactivated")) {
        alert("This project is deactivated.");
      } else if (data.message.includes("not found")) {
        alert("PID not found.");
      } else {
        alert("This project is not accessible.");
      }
      console.log("project with this pid did not found", data);
      setIsTyping(true);
    });

    socket.on("project_info", data => {
      if (data.error) {
        console.error("Error:", data.error);
        return;
      }
      console.log("project_info event: ", data);
      setProjectInfo(data);
    });

    return () => {
      // Cleanup timers on unmount
      if (maxTimeTimerRef.current) clearTimeout(maxTimeTimerRef.current);
      if (minTimeTimerRef.current) clearTimeout(minTimeTimerRef.current);
    };
  }, []);

  // Start max_time and min_time timers when chat begins
  useEffect(() => {
    if (!chatStartTime || chatEnded) return;

    const maxTime = parseInt(urlParams.max_time || "0");
    if (maxTime > 0) {
      maxTimeTimerRef.current = setTimeout(() => {
        endChat("max_time");
      }, maxTime * 1000);
    }

    const minTime = parseInt(urlParams.min_time || "0");
    if (minTime > 0) {
      minTimeTimerRef.current = setTimeout(() => {
        setMinTimeReached(true);
      }, minTime * 1000);
    } else {
      setMinTimeReached(true); // No min_time = always reached
    }
  }, [chatStartTime, chatEnded, urlParams.max_time, urlParams.min_time, endChat]);

  // Check max_messages after each message arrives
  useEffect(() => {
    if (chatEnded) return;
    const maxMessages = parseInt(urlParams.max_messages || "0");
    if (maxMessages > 0 && messages.length >= maxMessages) {
      // Only end after assistant's reply (last message should be assistant)
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.role === "assistant") {
        endChat("max_messages");
      }
    }
  }, [messages, chatEnded, urlParams.max_messages, endChat]);

  // Initialize session and fetch scenario when participant_id is known
  useEffect(() => {
    if (urlParams.participant_id && !scenarioInfo) {
      const debugMode = urlParams.debug === "true" || urlParams.debug === "1";
      initializeSession(urlParams.participant_id, debugMode);
    }
  }, [urlParams.participant_id, urlParams.debug]);

  const handleInputChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setNewMessage(event.target.value);
  };

  const handleSendClick = async () => {
    if (newMessage.length === 0 || chatEnded) return;

    let message: Message = {
      role: "user",
      content: newMessage
    };

    if (imageFile) {
      message = {
        role: "user",
        content_type: "image",
        content: {
          prompt: newMessage,
          image: imageFile.split(",")[1] // base64
        }
      };
      const image_message_to_add_locally = {
        content: [
          { type: "text", text: newMessage },
          {
            type: "image_url",
            image_url: {
              url: imageFile
            }
          }
        ],
        role: "user",
        timestamp: Date.now(),
        type: "image"
      };

      setMessages(prevMessages => [
        ...prevMessages,
        image_message_to_add_locally
      ]);
      await socket.emit("image_message", {
        data: message,
        session_id: sessionId,
        participant_id: participantId
      });
    } else {
      const text_message_to_add_locally = {
        session_id: "local",
        content: message.content,
        role: "user",
        timestamp: Date.now(),
        experiment_id: "local",
        participant_id: "local",
        type: "text"
      };
      setMessages(prevMessages => [
        ...prevMessages,
        text_message_to_add_locally
      ]);
      await socket.emit("text_message", {
        data: message,
        session_id: sessionId,
        participant_id: participantId
      });
    }

    console.log("ChatPage.handleSendClick", message);

    setImageFile(null);
    setNewMessage("");
    setIsTyping(true);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    handleSendClick();
  };

  const setIsTypingFalse = () => {
    setIsTyping(false);
  };

  // Derived: can the user end the chat early?
  const minMessages = parseInt(urlParams.min_messages || "0");
  const canEndChat = isLimeSurvey && !chatEnded && minTimeReached && messages.length >= minMessages;

  return (
    <>
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          height: "98vh",
          maxWidth: "800px",
          width: "100%",
          margin: "auto"
        }}
      >
        {/* Scenario Header */}
        {scenarioInfo && (
          <Box
            sx={{
              bgcolor: "#f5f5f5",
              p: 2,
              borderBottom: "1px solid #e0e0e0",
              textAlign: "center",
              position: "relative"
            }}
          >
            <div style={{ fontWeight: "bold", fontSize: "1.1em", marginBottom: "0.5em" }}>
              {scenarioInfo.scenario_title}
            </div>
            <div style={{ fontSize: "0.9em", color: "#666", fontStyle: "italic" }}>
              {scenarioInfo.scenario_description}
            </div>
            <div style={{ fontSize: "0.85em", color: "#888", marginTop: "0.5em" }}>
              You are <strong>{scenarioInfo.user_role}</strong>, talking to <strong>{scenarioInfo.ai_character}</strong>
            </div>
            <div style={{ fontSize: "0.85em", color: "#555", marginTop: "0.5em", fontWeight: 500 }}>
              {scenarioInfo.ai_speaks_first
                ? `${scenarioInfo.ai_character} starts the conversation.`
                : "You start the conversation."}
            </div>
            {scenarioInfo.debug_mode && (
              <div style={{
                fontSize: "0.75em",
                color: "#fff",
                backgroundColor: "#d32f2f",
                padding: "2px 8px",
                borderRadius: "4px",
                display: "inline-block",
                marginTop: "0.5em"
              }}>
                DEBUG MODE
              </div>
            )}
            {/* End Chat link in header */}
            {canEndChat && (
              <div
                style={{
                  position: "absolute",
                  top: "8px",
                  right: "12px",
                  fontSize: "0.8em",
                  color: "#999",
                  cursor: "pointer",
                  textDecoration: "underline"
                }}
                onClick={() => endChat("user_ended")}
              >
                End Chat
              </div>
            )}
          </Box>
        )}
        <ChatContainer
          messages={messages}
          setIsTypingFalse={setIsTypingFalse}
          userLabel={scenarioInfo?.user_role ? `${scenarioInfo.user_role} (You)` : (urlParams.user_label || projectInfo?.user_label || "You")}
          assistantLabel={scenarioInfo?.ai_character || urlParams.assistant_label || projectInfo?.assistant_label || "Assistant"}
        />

        {/* Chat ended state */}
        {chatEnded ? (
          isLimeSurvey ? (
            <Box sx={{ p: 3, textAlign: "center" }}>
              <Button
                variant="contained"
                color="primary"
                size="large"
                onClick={handleContinueClick}
                sx={{ mt: 1, px: 4, py: 1.5, fontSize: "1.1em" }}
              >
                Continue to Survey
              </Button>
            </Box>
          ) : (
            <Box sx={{ p: 2, textAlign: "center" }}>
              <Typography color="text.secondary">Chat session has ended.</Typography>
            </Box>
          )
        ) : (
          <>
            <div
              style={{
                display: "flex",
                justifyContent: "left",
                alignItems: "center",
                marginLeft: "1rem",
                marginBottom: "0.65rem"
              }}
            >
              {isTyping && (
                <>
                  <span>{projectInfo?.loading_message}</span>
                  <BlinkingDots />
                </>
              )}
            </div>
            <ChatInputForm
              newMessage={newMessage}
              handleInputChange={handleInputChange}
              handleSubmit={handleSubmit}
              isTyping={isTyping}
              setImageFile={setImageFile}
              imageFile={imageFile}
              onEndChat={canEndChat ? () => endChat("user_ended") : undefined}
            />
          </>
        )}
      </Box>
    </>
  );
};

export default ChatPage;
