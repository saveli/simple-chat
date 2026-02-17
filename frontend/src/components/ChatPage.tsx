import React, { useState, ChangeEvent, FormEvent, useEffect } from "react";
import ChatContainer from "./ChatContainer";
import ChatInputForm from "./ChatInputForm";
import { Box } from "@mui/material";
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

  // Fetch scenario info from aLLMa
  const fetchScenarioInfo = async (participantId: string) => {
    try {
      // aLLMa wrapper is accessible from browser at localhost:11435
      const allmaUrl = "http://localhost:11435";
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
      const allmaUrl = "http://localhost:11435";
      // Send a special init request to create the session
      const response = await fetch(`${allmaUrl}/v1/session/${participantId}/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participant_id: participantId, debug: debug })
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
  }, []);

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
    // Check if newMessage length is greater than 0
    if (newMessage.length === 0) {
      return;
    }

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

    // sendMessage(message);

    setImageFile(null);
    setNewMessage("");
    setIsTyping(true);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    handleSendClick();
  };

  // useEffect(() => {
  //   const lastMessage = messages[messages.length - 1];
  //   if (messages.length && lastMessage.role === "assistant") {
  //     setIsTyping(false);
  //   }
  // }, [messages]);

  const setIsTypingFalse = () => {
    setIsTyping(false);
  };
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
              textAlign: "center"
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
          </Box>
        )}
        <ChatContainer
          messages={messages}
          setIsTypingFalse={setIsTypingFalse}
          userLabel={scenarioInfo?.user_role ? `${scenarioInfo.user_role} (You)` : (urlParams.user_label || projectInfo?.user_label || "You")}
          assistantLabel={scenarioInfo?.ai_character || urlParams.assistant_label || projectInfo?.assistant_label || "Assistant"}
        />
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
        />
      </Box>
    </>
  );
};

export default ChatPage;
