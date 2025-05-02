import React, { useRef, useState, useEffect } from 'react';
import './App.css';

// Constants
const type = {
  ROOM_CREATE: {
    RESPONSE_SUCCESS: "CHECK_ROOM_RESPONSE_SUCCESS",
    RESPONSE_FAILURE: "CHECK_ROOM_RESPONSE_FAILURE",
  },
  ROOM_JOIN: {
    REQUEST: "JOIN_ROOM_REQUEST",
    RESPONSE_SUCCESS: "JOIN_ROOM_RESPONSE_SUCCESS",
    RESPONSE_FAILURE: "JOIN_ROOM_RESPONSE_FAILURE",
    NOTIFY: "JOIN_ROOM_NOTIFY",
  },
  ROOM_EXIT: {
    REQUEST: "EXIT_ROOM_REQUEST",
    NOTIFY: "EXIT_ROOM_NOTIFY",
  },
  WEB_RTC: {
    OFFER: "OFFER",
    ANSWER: "ANSWER",
    ICE_CANDIDATES: "ICE_CANDIDATES",
  },
};

const labels = {
  NORMAL_SERVER_PROCESS: "NORMAL_SERVER_PROCESS",
  WEBRTC_PROCESS: "WEBRTC_PROCESS",
};

const webRTCConfiguratons = {
  iceServers: [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
        'stun:stun3.l.google.com:19302',
        'stun:stun4.l.google.com:19302',
      ],
    },
  ],
};

// Utility Functions
const addOutgoingMessageToUi = (message, userId) => `${userId}: ${message}`;
const addIncomingMessageToUi = (message, otherUserId) => `${otherUserId}: ${message}`;

const App = () => {
  // State
  const [userId] = useState(Math.round(Math.random() * 1000000).toString());
  const [roomName, setRoomName] = useState('');
  const [otherUserId, setOtherUserId] = useState(null);
  const [channelName, setChannelName] = useState('');
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [iceCandidatesGenerated, setIceCandidatesGenerated] = useState([]);
  const [iceCandidatesReceivedBuffer, setIceCandidatesReceivedBuffer] = useState([]);

  // Refs
  const pc = useRef(null);
  const dataChannel = useRef(null);
  const wsConnection = useRef(null);
  const inputRoomNameElement = useRef(null);

  // WebSocket Setup and Cleanup
  useEffect(() => {
    const connectWebSocket = () => {
      try {
        wsConnection.current = new WebSocket(`ws://localhost:8080/?userId=${userId}`);

        wsConnection.current.onopen = () => {
          console.log('Connected to WebSocket server');
        };

        wsConnection.current.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            console.log('Received message:', message);
            switch (message.label) {
              case labels.NORMAL_SERVER_PROCESS:
                normalServerProcessing(message.data);
                break;
              case labels.WEBRTC_PROCESS:
                webRTCServerProcessing(message.data);
                break;
              default:
                console.log('Unknown server processing label:', message.label);
            }
          } catch (error) {
            console.error('Error processing WebSocket message:', error);
            alert('Failed to process server message.');
          }
        };

        wsConnection.current.onclose = () => {
          console.log('Disconnected from WebSocket server');
          alert('Disconnected from server. Retrying...');
          setTimeout(connectWebSocket, 5000);
        };

        wsConnection.current.onerror = (error) => {
          console.error('WebSocket error:', error);
          alert('Failed to connect to WebSocket server. Retrying...');
        };
      } catch (error) {
        console.error('WebSocket setup error:', error);
        alert('Failed to initialize WebSocket connection.');
      }
    };

    connectWebSocket();

    return () => {
      try {
        wsConnection.current?.close();
      } catch (error) {
        console.error('Error closing WebSocket:', error);
      }
    };
  }, [userId]);

  // Room Management
  const createRoom = () => {
    const name = channelName.trim();
    setChannelName('');
    if (!name) {
      alert('Your room needs a name');
      return;
    }
    try {
      const message = {
        label: labels.NORMAL_SERVER_PROCESS,
        data: {
          type: type.ROOM_CREATE.RESPONSE_SUCCESS,
          roomName: name,
          userId,
        },
      };
      wsConnection.current?.send(JSON.stringify(message));
    } catch (error) {
      console.error('Error creating room:', error);
      alert('Failed to create room.');
    }
  };

  const joinRoom = (name, id) => {
    try {
      const message = {
        label: labels.NORMAL_SERVER_PROCESS,
        data: {
          type: type.ROOM_JOIN.REQUEST,
          roomName: name,
          userId: id,
        },
      };
      wsConnection.current?.send(JSON.stringify(message));
    } catch (error) {
      console.error('Error joining room:', error);
      alert('Failed to join room.');
    }
  };

  const sendExitRoomRequest = (name, id) => {
    try {
      const message = {
        label: labels.NORMAL_SERVER_PROCESS,
        data: {
          type: type.ROOM_EXIT.RESPONSE,
          roomName: name,
          userId: id,
        },
      };
      wsConnection.current?.send(JSON.stringify(message));
    } catch (error) {
      console.error('Error sending exit room request:', error);
      alert('Failed to exit room.');
    }
  };

  // WebRTC Functions
  const createPeerConnectionObject = () => {
    try {
      pc.current = new RTCPeerConnection(webRTCConfiguratons);

      pc.current.onconnectionstatechange = () => {
        console.log('Connection state:', pc.current?.connectionState);
        if (pc.current?.connectionState === 'connected') {
          alert('WebRTC connection established!');
        } else if (pc.current?.connectionState === 'failed' || pc.current?.connectionState === 'closed') {
          console.log('WebRTC connection failed or closed');
          closePeerConnection();
        }
      };

      pc.current.onsignalingstatechange = () => {
        console.log('Signaling state:', pc.current?.signalingState);
      };

      pc.current.onicecandidate = (e) => {
        try {
          if (e.candidate) {
            console.log('ICE candidate:', e.candidate);
            setIceCandidatesGenerated((prev) => [...prev, e.candidate]);
            sendIceCandidates([e.candidate]);
          } else {
            console.log('No ICE candidate (null candidate)');
          }
        } catch (error) {
          console.error('Error handling ICE candidate:', error);
        }
      };
    } catch (error) {
      console.error('Error creating peer connection:', error);
      alert('Failed to create WebRTC peer connection.');
    }
  };

  const createDataChannel = (isOfferor) => {
    try {
      if (isOfferor) {
        const dataChannelOptions = { ordered: true };
        dataChannel.current = pc.current?.createDataChannel('chat', dataChannelOptions);
        registerDataChannelEventListeners();
      } else {
        pc.current.ondatachannel = (e) => {
          console.log('Data channel received:', e);
          dataChannel.current = e.channel;
          registerDataChannelEventListeners();
        };
      }
    } catch (error) {
      console.error('Error creating data channel:', error);
      alert('Failed to create WebRTC data channel.');
    }
  };

  const registerDataChannelEventListeners = () => {
    try {
      dataChannel.current.onmessage = (e) => {
        try {
          const msg = e.data;
          const formattedMessage = addIncomingMessageToUi(msg, otherUserId);
          setMessages((prev) => [...prev, formattedMessage]);
        } catch (error) {
          console.error('Error processing data channel message:', error);
        }
      };

      dataChannel.current.onopen = () => {
        console.log('Data channel opened');
      };

      dataChannel.current.onclose = () => {
        console.log('Data channel closed');
      };
    } catch (error) {
      console.error('Error registering data channel listeners:', error);
    }
  };

  const startWebRTCProcess = async () => {
    if (!otherUserId) {
      console.log('Cannot start WebRTC: otherUserId is null');
      return;
    }
    try {
      createPeerConnectionObject();
      createDataChannel(true);
      const offer = await pc.current?.createOffer();
      await pc.current?.setLocalDescription(offer);
      sendOffer(pc.current?.localDescription);
    } catch (error) {
      console.error('WebRTC error:', error);
      alert('Failed to initiate WebRTC connection.');
    }
  };

  const sendOffer = (offer) => {
    try {
      if (!otherUserId) {
        console.log('Cannot send offer: otherUserId is null');
        return;
      }
      const message = {
        label: labels.WEBRTC_PROCESS,
        data: { type: type.WEB_RTC.OFFER, offer, otherUserId },
      };
      wsConnection.current?.send(JSON.stringify(message));
    } catch (error) {
      console.error('Error sending offer:', error);
    }
  };

  const sendAnswer = (answer) => {
    try {
      if (!otherUserId) {
        console.log('Cannot send answer: otherUserId is null');
        return;
      }
      const message = {
        label: labels.WEBRTC_PROCESS,
        data: { type: type.WEB_RTC.ANSWER, answer, otherUserId },
      };
      wsConnection.current?.send(JSON.stringify(message));
    } catch (error) {
      console.error('Error sending answer:', error);
    }
  };

  const sendIceCandidates = (candidates) => {
    try {
      if (!otherUserId) {
        console.log('Cannot send ICE candidates: otherUserId is null');
        return;
      }
      const message = {
        label: labels.WEBRTC_PROCESS,
        data: { type: type.WEB_RTC.ICE_CANDIDATES, candidatesArray: candidates, otherUserId },
      };
      wsConnection.current?.send(JSON.stringify(message));
    } catch (error) {
      console.error('Error sending ICE candidates:', error);
    }
  };

  const handleOffer = async (data) => {
    try {
      createPeerConnectionObject();
      createDataChannel(false);
      await pc.current?.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await pc.current?.createAnswer();
      await pc.current?.setLocalDescription(answer);
      sendAnswer(answer);
    } catch (error) {
      console.error('Error handling offer:', error);
      alert('Failed to process WebRTC offer.');
    }
  };

  const handleAnswer = async (data) => {
    try {
      await pc.current?.setRemoteDescription(new RTCSessionDescription(data.answer));
      for (const candidate of iceCandidatesReceivedBuffer) {
        await pc.current?.addIceCandidate(candidate);
      }
      setIceCandidatesReceivedBuffer([]);
    } catch (error) {
      console.error('Error handling answer:', error);
      alert('Failed to process WebRTC answer.');
    }
  };

  const handleIceCandidates = async (data) => {
    try {
      if (pc.current?.remoteDescription) {
        for (const candidate of data.candidatesArray) {
          await pc.current?.addIceCandidate(new RTCIceCandidate(candidate));
        }
      } else {
        setIceCandidatesReceivedBuffer((prev) => [
          ...prev,
          ...data.candidatesArray.map((c) => new RTCIceCandidate(c)),
        ]);
      }
    } catch (error) {
      console.error('Error adding ICE candidates:', error);
    }
  };

  const sendMessageUsingDataChannel = (msg) => {
    try {
      if (dataChannel.current?.readyState === 'open') {
        dataChannel.current.send(msg);
      } else {
        console.log('Data channel not open');
        alert('Data channel is not open');
      }
    } catch (error) {
      console.error('Error sending data channel message:', error);
    }
  };

  const closePeerConnection = () => {
    try {
      if (pc.current) {
        pc.current.close();
        pc.current = null;
        dataChannel.current = null;
        console.log('Peer connection closed');
      }
    } catch (error) {
      console.error('Error closing peer connection:', error);
    }
  };

  // Server Processing
  const normalServerProcessing = (data) => {
    try {
      switch (data.type) {
        case type.ROOM_CREATE.RESPONSE_SUCCESS:
          setRoomName(data.roomName);
          alert('Room created successfully.');
          break;
        case type.ROOM_CREATE.RESPONSE_FAILURE:
          console.log('Create room failed:', data.message);
          alert(data.message || 'Failed to create room.');
          break;
        case type.ROOM_JOIN.RESPONSE_SUCCESS:
          joinSuccessHandler(data);
          break;
        case type.ROOM_JOIN.RESPONSE_FAILURE:
          console.log('Join room failed:', data.message);
          alert(data.message || 'Failed to join room.');
          break;
        case type.ROOM_JOIN.NOTIFY:
          setOtherUserId(data.joinUserId);
          alert(`User ${data.joinUserId} has joined your room`);
          startWebRTCProcess();
          break;
        case type.ROOM_EXIT.NOTIFY:
          setOtherUserId(null);
          alert(data.message || 'A user has left your room');
          closePeerConnection();
          exitRoom();
          break;
        default:
          console.log('Unknown data type:', data.type);
      }
    } catch (error) {
      console.error('Error processing normal server message:', error);
    }
  };

  const webRTCServerProcessing = (data) => {
    try {
      switch (data.type) {
        case type.WEB_RTC.OFFER:
          handleOffer(data);
          break;
        case type.WEB_RTC.ANSWER:
          handleAnswer(data);
          break;
        case type.WEB_RTC.ICE_CANDIDATES:
          handleIceCandidates(data);
          break;
        default:
          console.log('Unknown data type:', data.type);
      }
    } catch (error) {
      console.error('Error processing WebRTC message:', error);
    }
  };

  const joinSuccessHandler = (data) => {
    try {
      if (data.creatorId && data.creatorId !== userId) {
        setOtherUserId(data.creatorId);
      }
      setRoomName(data.roomName);
      startWebRTCProcess();
      alert('Joined room successfully');
    } catch (error) {
      console.error('Error handling join success:', error);
    }
  };

  // UI Handlers
  const exitRoom = () => {
    try {
      inputRoomNameElement.current.value = '';
      setRoomName('');
      setOtherUserId(null);
      setChannelName('');
      setMessages([]);
    } catch (error) {
      console.error('Error exiting room:', error);
    }
  };

  const handleCreateRoom = () => {
    createRoom();
  };

  const handleJoinRoom = () => {
    const name = channelName.trim();
    setChannelName('');
    if (!name) {
      alert('You have to join a room with a valid name');
      return;
    }
    joinRoom(name, userId);
  };

  const handleExitRoom = () => {
    if (roomName) {
      sendExitRoomRequest(roomName, userId);
    }
    exitRoom();
    closePeerConnection();
  };

  const handleSendMessage = () => {
    const msg = message.trim();
    setMessage('');
    if (msg) {
      const formattedMessage = addOutgoingMessageToUi(msg, userId);
      setMessages((prev) => [...prev, formattedMessage]);
      sendMessageUsingDataChannel(msg);
    }
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.header}>WebRTC Chat Room (User ID: {userId})</h1>

      {/* Channel Name Input */}
      <input
        ref={inputRoomNameElement}
        style={styles.input}
        placeholder="Enter room name"
        value={channelName}
        onChange={(e) => setChannelName(e.target.value)}
      />

      {/* Buttons for Room Actions */}
      <div style={styles.buttonContainer}>
        <button style={styles.button} onClick={handleCreateRoom}>
          Create Room
        </button>
        <button style={styles.button} onClick={handleJoinRoom}>
          Join Room
        </button>
      </div>
      <div style={styles.buttonContainer}>
        <button style={styles.button} onClick={handleExitRoom}>
          Exit Room
        </button>
      </div>

      {/* Message Input */}
      <input
        style={styles.input}
        placeholder="Type a message..."
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />

      {/* Send Button */}
      <button style={styles.sendButton} onClick={handleSendMessage}>
        Send
      </button>

      {/* Message Container */}
      <div style={styles.messageContainer}>
        {messages.length === 0 ? (
          <p style={styles.noMessages}>No messages yet</p>
        ) : (
          messages.map((msg, index) => (
            <p key={index} style={styles.message}>
              {msg}
            </p>
          ))
        )}
      </div>
    </div>
  );
};

const styles = {
  container: {
    maxWidth: '600px',
    margin: '0 auto',
    padding: '20px',
    backgroundColor: '#f5f5f5',
    minHeight: '100vh',
  },
  header: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '20px',
    textAlign: 'center',
  },
  input: {
    width: '100%',
    height: '40px',
    border: '1px solid #ccc',
    borderRadius: '5px',
    padding: '0 10px',
    marginBottom: '20px',
    fontSize: '16px',
    boxSizing: 'border-box',
  },
  buttonContainer: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '20px',
  },
  button: {
    flex: 1,
    backgroundColor: '#007AFF',
    color: '#fff',
    padding: '10px',
    borderRadius: '5px',
    border: 'none',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer',
    margin: '0 5px',
  },
  sendButton: {
    width: '100%',
    backgroundColor: '#007AFF',
    color: '#fff',
    padding: '10px',
    borderRadius: '5px',
    border: 'none',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer',
    marginBottom: '20px',
  },
  messageContainer: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: '5px',
    padding: '10px',
    minHeight: '100px',
    boxSizing: 'border-box',
  },
  message: {
    fontSize: '14px',
    color: '#333',
    marginBottom: '5px',
  },
  noMessages: {
    fontSize: '14px',
    color: '#666',
    textAlign: 'center',
  },
};

export default App;



const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 8080 });
const rooms = {};
const clients = {};

wss.on('connection', (ws, req) => {
  const urlParams = new URLSearchParams(req.url.split('?')[1]);
  const userId = urlParams.get('userId');

  if (!userId) {
    ws.close();
    return;
  }

  clients[userId] = ws;
  console.log(`User ${userId} connected`);

  ws.on('message', (message) => {
    try {
      const parsedMessage = JSON.parse(message);
      console.log('Received:', parsedMessage);

      if (parsedMessage.label === 'NORMAL_SERVER_PROCESS') {
        handleNormalServerProcess(parsedMessage.data, userId);
      } else if (parsedMessage.label === 'WEBRTC_PROCESS') {
        handleWebRTCProcess(parsedMessage.data, userId);
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  });

  ws.on('close', () => {
    console.log(`User ${userId} disconnected`);
    handleUserDisconnect(userId);
  });

  ws.on('error', (error) => {
    console.error(`WebSocket error for user ${userId}:`, error);
  });
});

const handleNormalServerProcess = (data, userId) => {
  switch (data.type) {
    case 'CHECK_ROOM_RESPONSE_SUCCESS':
      if (!rooms[data.roomName]) {
        rooms[data.roomName] = { creatorId: userId, participants: [userId] };
        console.log(`Room ${data.roomName} created by ${userId}`);
        sendToClient(userId, {
          label: 'NORMAL_SERVER_PROCESS',
          data: { type: 'CHECK_ROOM_RESPONSE_SUCCESS', roomName: data.roomName },
        });
      } else {
        sendToClient(userId, {
          label: 'NORMAL_SERVER_PROCESS',
          data: { type: 'CHECK_ROOM_RESPONSE_FAILURE', message: 'Room already exists' },
        });
      }
      break;

    case 'JOIN_ROOM_REQUEST':
      if (rooms[data.roomName]) {
        if (!rooms[data.roomName].participants.includes(userId)) {
          rooms[data.roomName].participants.push(userId);
          console.log(`User ${userId} joined room ${data.roomName}`);
          sendToClient(userId, {
            label: 'NORMAL_SERVER_PROCESS',
            data: {
              type: 'JOIN_ROOM_RESPONSE_SUCCESS',
              roomName: data.roomName,
              creatorId: rooms[data.roomName].creatorId,
            },
          });
          rooms[data.roomName].participants.forEach((participant) => {
            if (participant !== userId) {
              sendToClient(participant, {
                label: 'NORMAL_SERVER_PROCESS',
                data: {
                  type: 'JOIN_ROOM_NOTIFY',
                  roomName: data.roomName,
                  joinUserId: userId,
                },
              });
            }
          });
        } else {
          sendToClient(userId, {
            label: 'NORMAL_SERVER_PROCESS',
            data: { type: 'JOIN_ROOM_RESPONSE_FAILURE', message: 'Already in room' },
          });
        }
      } else {
        sendToClient(userId, {
          label: 'NORMAL_SERVER_PROCESS',
          data: { type: 'JOIN_ROOM_RESPONSE_FAILURE', message: 'Room does not exist' },
        });
      }
      break;

    case 'EXIT_ROOM_REQUEST':
      if (rooms[data.roomName] && rooms[data.roomName].participants.includes(userId)) {
        rooms[data.roomName].participants = rooms[data.roomName].participants.filter(
          (id) => id !== userId
        );
        console.log(`User ${userId} disconnected from room ${data.roomName}`);
        if (rooms[data.roomName].participants.length === 0) {
          delete rooms[data.roomName];
          console.log(`Room ${data.roomName} deleted`);
        } else {
          rooms[data.roomName].participants.forEach((participant) => {
            sendToClient(participant, {
              label: 'NORMAL_SERVER_PROCESS',
              data: {
                type: 'EXIT_ROOM_NOTIFY',
                roomName: data.roomName,
                message: `User ${userId} has left the room`,
              },
            });
          });
        }
      }
      break;

    default:
      console.log('Unknown normal server process type:', data.type);
  }
};

const handleWebRTCProcess = (data, userId) => {
  const targetUserId = data.otherUserId;
  if (targetUserId && clients[targetUserId]) {
    console.log(`Relayed WebRTC message type ${data.type} from ${userId}`);
    sendToClient(targetUserId, {
      label: 'WEBRTC_PROCESS',
      data: { ...data, otherUserId: userId },
    });
  } else {
    console.log(`Target user ${targetUserId} not found for WebRTC message from ${userId}`);
  }
};

const handleUserDisconnect = (userId) => {
  delete clients[userId];
  Object.keys(rooms).forEach((roomName) => {
    if (rooms[roomName].participants.includes(userId)) {
      rooms[roomName].participants = rooms[roomName].participants.filter((id) => id !== userId);
      console.log(`User ${userId} disconnected from room ${roomName}`);
      if (rooms[roomName].participants.length === 0) {
        delete rooms[roomName];
        console.log(`Room ${roomName} deleted`);
      } else {
        rooms[roomName].participants.forEach((participant) => {
          sendToClient(participant, {
            label: 'NORMAL_SERVER_PROCESS',
            data: {
              type: 'EXIT_ROOM_NOTIFY',
              roomName,
              message: `User ${userId} has left the room`,
            },
          });
        });
      }
    }
  });
};

const sendToClient = (userId, message) => {
  if (clients[userId] && clients[userId].readyState === WebSocket.OPEN) {
    clients[userId].send(JSON.stringify(message));
  } else {
    console.log(`Cannot send to user ${userId}: client not connected`);
  }
};

console.log('WebSocket server running on ws://localhost:8080');







import React, { useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  SafeAreaView,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCDataChannel,
} from 'react-native-webrtc';

// Constants
const type = {
  ROOM_CREATE: {
    RESPONSE_SUCCESS: "CHECK_ROOM_RESPONSE_SUCCESS",
    RESPONSE_FAILURE: "CHECK_ROOM_RESPONSE_FAILURE",
  },
  ROOM_JOIN: {
    REQUEST: "JOIN_ROOM_REQUEST",
    RESPONSE_SUCCESS: "JOIN_ROOM_RESPONSE_SUCCESS",
    RESPONSE_FAILURE: "JOIN_ROOM_RESPONSE_FAILURE",
    NOTIFY: "JOIN_ROOM_NOTIFY",
  },
  ROOM_EXIT: {
    REQUEST: "EXIT_ROOM_REQUEST",
    NOTIFY: "EXIT_ROOM_NOTIFY",
  },
  WEB_RTC: {
    OFFER: "OFFER",
    ANSWER: "ANSWER",
    ICE_CANDIDATES: "ICE_CANDIDATES",
  },
};

const labels = {
  NORMAL_SERVER_PROCESS: "NORMAL_SERVER_PROCESS",
  WEBRTC_PROCESS: "WEBRTC_PROCESS",
};

const webRTCConfiguratons = {
  iceServers: [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
        'stun:stun3.l.google.com:19302',
        'stun:stun4.l.google.com:19302',
      ],
    },
  ],
};

// Utility Functions
const addOutgoingMessageToUi = (message, userId) => `${userId}: ${message}`;
const addIncomingMessageToUi = (message, otherUserId) => `${otherUserId}: ${message}`;

const App = () => {
  // State
  const [userId] = useState(Math.round(Math.random() * 1000000).toString());
  const [roomName, setRoomName] = useState('');
  const [otherUserId, setOtherUserId] = useState(null);
  const [channelName, setChannelName] = useState('');
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [iceCandidatesGenerated, setIceCandidatesGenerated] = useState([]);
  const [iceCandidatesReceivedBuffer, setIceCandidatesReceivedBuffer] = useState([]);

  // Refs
  const pc = useRef(null);
  const dataChannel = useRef(null);
  const wsConnection = useRef(null);
  const inputRoomNameElement = useRef(null);

  // WebSocket Setup and Cleanup
  useEffect(() => {
    const connectWebSocket = () => {
      try {
        wsConnection.current = new WebSocket(`ws://10.0.2.2:8080/?userId=${userId}`);

        wsConnection.current.onopen = () => {
          console.log('Connected to WebSocket server');
        };

        wsConnection.current.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            console.log('Received message:', message);
            switch (message.label) {
              case labels.NORMAL_SERVER_PROCESS:
                normalServerProcessing(message.data);
                break;
              case labels.WEBRTC_PROCESS:
                webRTCServerProcessing(message.data);
                break;
              default:
                console.log('Unknown server processing label:', message.label);
            }
          } catch (error) {
            console.error('Error processing WebSocket message:', error);
            Alert.alert('Error', 'Failed to process server message.');
          }
        };

        wsConnection.current.onclose = () => {
          console.log('Disconnected from WebSocket server');
          Alert.alert('Info', 'Disconnected from server. Retrying...');
          setTimeout(connectWebSocket, 10000);
        };

        wsConnection.current.onerror = (error) => {
          console.error('WebSocket error:', error);
          Alert.alert('Error', 'Failed to connect to WebSocket server. Retrying...');
        };
      } catch (error) {
        console.error('WebSocket setup error:', error);
        Alert.alert('Error', 'Failed to initialize WebSocket connection.');
      }
    };

    connectWebSocket();

    return () => {
      try {
        wsConnection.current?.close();
      } catch (error) {
        console.error('Error closing WebSocket:', error);
      }
    };
  }, [userId]);

  // Room Management
  const createRoom = () => {
    const name = channelName.trim();
    setChannelName('');
    if (!name) {
      Alert.alert('Error', 'Your room needs a name');
      return;
    }
    try {
      const message = {
        label: labels.NORMAL_SERVER_PROCESS,
        data: {
          type: type.ROOM_CREATE.RESPONSE_SUCCESS,
          roomName: name,
          userId,
        },
      };
      wsConnection.current?.send(JSON.stringify(message));
    } catch (error) {
      console.error('Error creating room:', error);
      Alert.alert('Error', 'Failed to create room.');
    }
  };

  const joinRoom = (name, id) => {
    try {
      const message = {
        label: labels.NORMAL_SERVER_PROCESS,
        data: {
          type: type.ROOM_JOIN.REQUEST,
          roomName: name,
          userId: id,
        },
      };
      wsConnection.current?.send(JSON.stringify(message));
    } catch (error) {
      console.error('Error joining room:', error);
      Alert.alert('Error', 'Failed to join room.');
    }
  };

  const sendExitRoomRequest = (name, id) => {
    try {
      const message = {
        label: labels.NORMAL_SERVER_PROCESS,
        data: {
          type: type.ROOM_EXIT.REQUEST,
          roomName: name,
          userId: id,
        },
      };
      wsConnection.current?.send(JSON.stringify(message));
    } catch (error) {
      console.error('Error sending exit room request:', error);
      Alert.alert('Error', 'Failed to exit room.');
    }
  };

  // WebRTC Functions
  const createPeerConnectionObject = () => {
    try {
      pc.current = new RTCPeerConnection(webRTCConfiguratons);

      pc.current.onconnectionstatechange = () => {
        console.log('Connection state:', pc.current?.connectionState);
        if (pc.current?.connectionState === 'connected') {
          Alert.alert('Success', 'WebRTC connection established!');
        } else if (pc.current?.connectionState === 'failed' || pc.current?.connectionState === 'closed') {
          console.log('WebRTC connection failed or closed');
          closePeerConnection();
        }
      };

      pc.current.onsignalingstatechange = () => {
        console.log('Signaling state:', pc.current?.signalingState);
      };

      pc.current.onicecandidate = (e) => {
        try {
          if (e.candidate) {
            console.log('ICE candidate:', e.candidate);
            setIceCandidatesGenerated((prev) => [...prev, e.candidate]);
            sendIceCandidates([e.candidate]);
          } else {
            console.log('No ICE candidate (null candidate)');
          }
        } catch (error) {
          console.error('Error handling ICE candidate:', error);
        }
      };
    } catch (error) {
      console.error('Error creating peer connection:', error);
      Alert.alert('Error', 'Failed to create WebRTC peer connection.');
    }
  };

  const createDataChannel = (isOfferor) => {
    try {
      if (isOfferor) {
        const dataChannelOptions = { ordered: true };
        dataChannel.current = pc.current?.createDataChannel('chat', dataChannelOptions);
        registerDataChannelEventListeners();
      } else {
        pc.current.ondatachannel = (e) => {
          console.log('Data channel received:', e);
          dataChannel.current = e.channel;
          registerDataChannelEventListeners();
        };
      }
    } catch (error) {
      console.error('Error creating data channel:', error);
      Alert.alert('Error', 'Failed to create WebRTC data channel.');
    }
  };

  const registerDataChannelEventListeners = () => {
    try {
      dataChannel.current.onmessage = (e) => {
        try {
          const msg = e.data;
          const formattedMessage = addIncomingMessageToUi(msg, otherUserId);
          setMessages((prev) => [...prev, formattedMessage]);
        } catch (error) {
          console.error('Error processing data channel message:', error);
        }
      };

      dataChannel.current.onopen = () => {
        console.log('Data channel opened');
      };

      dataChannel.current.onclose = () => {
        console.log('Data channel closed');
      };
    } catch (error) {
      console.error('Error registering data channel listeners:', error);
    }
  };

  const startWebRTCProcess = async () => {
    if (!otherUserId) {
      console.log('Cannot start WebRTC: otherUserId is null');
      return;
    }
    console.log('Starting WebRTC with otherUserId:', otherUserId);
    try {
      createPeerConnectionObject();
      createDataChannel(true);
      const offer = await pc.current?.createOffer();
      await pc.current?.setLocalDescription(offer);
      sendOffer(pc.current?.localDescription);
    } catch (error) {
      console.error('WebRTC error:', error);
      Alert.alert('Error', 'Failed to initiate WebRTC connection.');
    }
  };

  const sendOffer = (offer) => {
    try {
      if (!otherUserId) {
        console.log('Cannot send offer: otherUserId is null');
        return;
      }
      const message = {
        label: labels.WEBRTC_PROCESS,
        data: { type: type.WEB_RTC.OFFER, offer, otherUserId },
      };
      console.log('Sending offer:', message);
      wsConnection.current?.send(JSON.stringify(message));
    } catch (error) {
      console.error('Error sending offer:', error);
    }
  };

  const sendAnswer = (answer) => {
    try {
      if (!otherUserId) {
        console.log('Cannot send answer: otherUserId is null');
        return;
      }
      const message = {
        label: labels.WEBRTC_PROCESS,
        data: { type: type.WEB_RTC.ANSWER, answer, otherUserId },
      };
      console.log('Sending answer:', message);
      wsConnection.current?.send(JSON.stringify(message));
    } catch (error) {
      console.error('Error sending answer:', error);
    }
  };

  const sendIceCandidates = (candidates) => {
    try {
      if (!otherUserId) {
        console.log('Cannot send ICE candidates: otherUserId is null');
        return;
      }
      const message = {
        label: labels.WEBRTC_PROCESS,
        data: { type: type.WEB_RTC.ICE_CANDIDATES, candidatesArray: candidates, otherUserId },
      };
      console.log('Sending ICE candidates:', message);
      wsConnection.current?.send(JSON.stringify(message));
    } catch (error) {
      console.error('Error sending ICE candidates:', error);
    }
  };

  const handleOffer = async (data) => {
    try {
      createPeerConnectionObject();
      createDataChannel(false);
      await pc.current?.setRemoteDescription(data.offer);
      const answer = await pc.current?.createAnswer();
      await pc.current?.setLocalDescription(answer);
      sendAnswer(answer);
    } catch (error) {
      console.error('Error handling offer:', error);
      Alert.alert('Error', 'Failed to process WebRTC offer.');
    }
  };

  const handleAnswer = async (data) => {
    try {
      await pc.current?.setRemoteDescription(data.answer);
      for (const candidate of iceCandidatesReceivedBuffer) {
        await pc.current?.addIceCandidate(candidate);
      }
      setIceCandidatesReceivedBuffer([]);
    } catch (error) {
      console.error('Error handling answer:', error);
      Alert.alert('Error', 'Failed to process WebRTC answer.');
    }
  };

  const handleIceCandidates = async (data) => {
    try {
      if (pc.current?.remoteDescription) {
        for (const candidate of data.candidatesArray) {
          await pc.current?.addIceCandidate(new RTCIceCandidate(candidate));
        }
      } else {
        setIceCandidatesReceivedBuffer((prev) => [
          ...prev,
          ...data.candidatesArray.map((c) => new RTCIceCandidate(c)),
        ]);
      }
    } catch (error) {
      console.error('Error adding ICE candidates:', error);
    }
  };

  const sendMessageUsingDataChannel = (msg) => {
    try {
      if (dataChannel.current?.readyState === 'open') {
        dataChannel.current.send(msg);
      } else {
        console.log('Data channel not open');
        Alert.alert('Error', 'Data channel is not open');
      }
    } catch (error) {
      console.error('Error sending data channel message:', error);
      Alert.alert('Error', 'Failed to send message.');
    }
  };

  const closePeerConnection = () => {
    try {
      if (pc.current) {
        pc.current.close();
        pc.current = null;
        dataChannel.current = null;
        console.log('Peer connection closed');
      }
    } catch (error) {
      console.error('Error closing peer connection:', error);
    }
  };

  // Server Processing
  const normalServerProcessing = (data) => {
    try {
      switch (data.type) {
        case type.ROOM_CREATE.RESPONSE_SUCCESS:
          setRoomName(data.roomName);
          Alert.alert('Success', 'Room created successfully.');
          break;
        case type.ROOM_CREATE.RESPONSE_FAILURE:
          console.log('Create room failed:', data.message);
          Alert.alert('Error', data.message || 'Failed to create room.');
          break;
        case type.ROOM_JOIN.RESPONSE_SUCCESS:
          joinSuccessHandler(data);
          break;
        case type.ROOM_JOIN.RESPONSE_FAILURE:
          console.log('Join room failed:', data.message);
          Alert.alert('Error', data.message || 'Failed to join room.');
          break;
        case type.ROOM_JOIN.NOTIFY:
          setOtherUserId(data.joinUserId);
          Alert.alert('Notification', `User ${data.joinUserId} has joined your room`);
          console.log('otherUserId after set:', otherUserId); // Will still show old value
          console.log('data:', data);
          console.log('data.joinUserId:', data.joinUserId);
          if (data.joinUserId) { // Use data.joinUserId directly
            console.log('Hello control is here.');
            startWebRTCProcess();
          } else {
            console.log('Cannot start WebRTC: data.joinUserId is null or undefined');
          }
          break;
        case type.ROOM_EXIT.NOTIFY:
          setOtherUserId(null);
          Alert.alert('Notification', data.message || 'A user has left your room');
          closePeerConnection();
          exitRoom();
          break;
        default:
          console.log('Unknown data type:', data.type);
      }
    } catch (error) {
      console.error('Error processing normal server message:', error);
      Alert.alert('Error', 'Failed to process server message.');
    }
  };

  const webRTCServerProcessing = (data) => {
    try {
      switch (data.type) {
        case type.WEB_RTC.OFFER:
          handleOffer(data);
          break;
        case type.WEB_RTC.ANSWER:
          handleAnswer(data);
          break;
        case type.WEB_RTC.ICE_CANDIDATES:
          handleIceCandidates(data);
          break;
        default:
          console.log('Unknown data type:', data.type);
      }
    } catch (error) {
      console.error('Error processing WebRTC message:', error);
      Alert.alert('Error', 'Failed to process WebRTC message.');
    }
  };

  const joinSuccessHandler = (data) => {
    try {
      const creatorId = data.creatorId && data.creatorId !== userId ? data.creatorId : null;
      setOtherUserId(creatorId);
      setRoomName(data.roomName);
      if (creatorId) {
        console.log('joinSuccessHandler: Starting WebRTC with creatorId:', creatorId);
        startWebRTCProcess();
      }
      Alert.alert('Success', 'Joined room successfully');
    } catch (error) {
      console.error('Error handling join success:', error);
      Alert.alert('Error', 'Failed to handle room join.');
    }
  };

  // UI Handlers
  const exitRoom = () => {
    try {
      inputRoomNameElement.current?.clear();
      setRoomName('');
      setOtherUserId(null);
      setChannelName('');
      setMessages([]);
    } catch (error) {
      console.error('Error exiting room:', error);
    }
  };

  const handleCreateRoom = () => {
    createRoom();
  };

  const handleJoinRoom = () => {
    const name = channelName.trim();
    setChannelName('');
    if (!name) {
      Alert.alert('Error', 'You have to join a room with a valid name');
      return;
    }
    joinRoom(name, userId);
  };

  const handleExitRoom = () => {
    if (roomName) {
      sendExitRoomRequest(roomName, userId);
    }
    exitRoom();
    closePeerConnection();
  };

  const handleSendMessage = () => {
    const msg = message.trim();
    setMessage('');
    if (msg) {
      const formattedMessage = addOutgoingMessageToUi(msg, userId);
      setMessages((prev) => [...prev, formattedMessage]);
      sendMessageUsingDataChannel(msg);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <Text style={styles.header}>WebRTC Chat Room (User ID: {userId})</Text>

        {/* Channel Name Input */}
        <TextInput
          ref={inputRoomNameElement}
          style={styles.input}
          placeholder="Enter room name"
          value={channelName}
          onChangeText={setChannelName}
        />

        {/* Buttons for Room Actions */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity style={styles.button} onPress={handleCreateRoom}>
            <Text style={styles.buttonText}>Create Room</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.button} onPress={handleJoinRoom}>
            <Text style={styles.buttonText}>Join Room</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.buttonContainer}>
          <TouchableOpacity style={styles.button} onPress={handleExitRoom}>
            <Text style={styles.buttonText}>Exit Room</Text>
          </TouchableOpacity>
        </View>

        {/* Message Input */}
        <TextInput
          style={styles.input}
          placeholder="Type a message..."
          value={message}
          onChangeText={setMessage}
        />

        {/* Send Button */}
        <TouchableOpacity style={styles.sendButton} onPress={handleSendMessage}>
          <Text style={styles.buttonText}>Send</Text>
        </TouchableOpacity>

        {/* Message Container */}
        <View style={styles.messageContainer}>
          {messages.length === 0 ? (
            <Text style={styles.noMessages}>No messages yet</Text>
          ) : (
            messages.map((msg, index) => (
              <Text key={index} style={styles.message}>
                {msg}
              </Text>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollContainer: {
    padding: 20,
    alignItems: 'center',
  },
  header: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 20,
  },
  input: {
    width: '100%',
    height: 40,
    borderColor: '#ccc',
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 10,
    marginBottom: 20,
    backgroundColor: '#fff',
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 20,
  },
  button: {
    flex: 1,
    backgroundColor: '#007AFF',
    padding: 10,
    borderRadius: 5,
    alignItems: 'center',
    marginHorizontal: 5,
  },
  sendButton: {
    width: '100%',
    backgroundColor: '#007AFF',
    padding: 10,
    borderRadius: 5,
    alignItems: 'center',
    marginBottom: 20,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  messageContainer: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 5,
    padding: 10,
    minHeight: 100,
  },
  message: {
    fontSize: 14,
    color: '#333',
    marginBottom: 5,
  },
  noMessages: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
});

export default App;












import React, { useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  SafeAreaView,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCDataChannel,
} from 'react-native-webrtc';

// Constants
const type = {
  ROOM_CREATE: {
    RESPONSE_FAILURE: "CHECK_ROOM_RESPONSE_FAILURE",
    RESPONSE_SUCCESS: "CHECK_ROOM_RESPONSE_SUCCESS",
  },
  ROOM_DESTROY: {
    RESPONSE_FAILURE: "DESTROY_ROOM_RESPONSE_FAILURE",
    RESPONSE_SUCCESS: "DESTROY_ROOM_RESPONSE_SUCCESS",
  },
  ROOM_JOIN: {
    RESPONSE_FAILURE: "JOIN_ROOM_RESPONSE_FAILURE",
    RESPONSE_SUCCESS: "JOIN_ROOM_RESPONSE_SUCCESS",
    REQUEST: "JOIN_ROOM_REQUEST",
    NOTIFY: "JOIN_ROOM_NOTIFY",
  },
  ROOM_EXIT: {
    REQUEST: "EXIT_ROOM_REQUEST",
    NOTIFY: "EXIT_ROOM_NOTIFY",
  },
  ROOM_DISONNECTION: {
    NOTIFY: "DISCONNECT_ROOM_NOTIFICATION",
  },
  WEB_RTC: {
    OFFER: "OFFER",
    ANSWER: "ANSWER",
    ICE_CANDIDATES: "ICE_CANDIDATES",
  },
};

const labels = {
  NORMAL_SERVER_PROCESS: "NORMAL_SERVER_PROCESS",
  WEBRTC_PROCESS: "WEBRTC_PROCESS",
};

const webRTCConfiguratons = {
  iceServers: [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
        'stun:stun3.l.google.com:19302',
        'stun:stun4.l.google.com:19302',
      ],
    },
  ],
};

// Utility Functions
const addOutgoingMessageToUi = (message, userId) => `${userId}: ${message}`;
const addIncomingMessageToUi = (message, otherUserId) => `${otherUserId}: ${message}`;

const App = () => {
  // State
  const [userId] = useState(Math.round(Math.random() * 1000000).toString());
  const [roomName, setRoomName] = useState('');
  const [otherUserId, setOtherUserId] = useState(null);
  const [channelName, setChannelName] = useState('');
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [iceCandidatesGenerated, setIceCandidatesGenerated] = useState([]);
  const [iceCandidatesReceivedBuffer, setIceCandidatesReceivedBuffer] = useState([]);

  // Refs
  const pc = useRef(null);
  const dataChannel = useRef(null);
  const wsConnection = useRef(null);
  const inputRoomNameElement = useRef(null);

  // WebSocket Setup and Cleanup
  useEffect(() => {
    wsConnection.current = new WebSocket(`ws://10.0.2.2:8080/?userId=${userId}`);

    wsConnection.current.onopen = () => {
      console.log('Connected to WebSocket server');
    };

    wsConnection.current.onmessage = (event) => {
      const message = JSON.parse(event.data);
      console.log('Received message:', message); // Debugging
      switch (message.label) {
        case labels.NORMAL_SERVER_PROCESS:
          normalServerProcessing(message.data);
          break;
        case labels.WEBRTC_PROCESS:
          webRTCServerProcessing(message.data);
          break;
        default:
          console.log('Unknown server processing label:', message.label);
      }
    };

    wsConnection.current.onclose = () => {
      console.log('Disconnected from WebSocket server');
    };

    wsConnection.current.onerror = () => {
      console.log('WebSocket error');
    };

    return () => {
      wsConnection.current?.close();
    };
  }, [userId]);

  // Room Management
  const createRoom = async (name, id) => {
    try {
      const response = await fetch('http://10.0.2.2:8080/create-room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName: name, userId: id }),
      });
      const resObj = await response.json();
      if (resObj.data.type === type.ROOM_CREATE.RESPONSE_SUCCESS) {
        setRoomName(name);
        Alert.alert('Success', 'Room created successfully.');
      } else {
        console.log('Create Room Failure:', resObj.data.message);
        Alert.alert('Error', resObj.data.message || 'Failed to create room.');
      }
    } catch (err) {
      console.log('Error creating room:', err);
      Alert.alert('Error', 'An error occurred while creating the room.');
    }
  };

  const destroyRoom = async (name) => {
    try {
      const response = await fetch('http://10.0.2.2:8080/destroy-room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName: name }),
      });
      const resObj = await response.json();
      if (resObj.data.type === type.ROOM_DESTROY.RESPONSE_SUCCESS) {
        exitRoom();
        Alert.alert('Success', 'Room destroyed successfully.');
      } else {
        console.log('Destroy Room Failure:', resObj.data.message);
        Alert.alert('Error', resObj.data.message || 'Failed to destroy room.');
      }
    } catch (err) {
      console.log('Error destroying room:', err);
      Alert.alert('Error', 'An error occurred while destroying the room.');
    }
  };

  const joinRoom = (name, id) => {
    const message = {
      label: labels.NORMAL_SERVER_PROCESS,
      data: {
        type: type.ROOM_JOIN.REQUEST,
        roomName: name,
        userId: id
      }
    };
    wsConnection.current?.send(JSON.stringify(message));
  };

  const sendExitRoomRequest = (name, id) => {
    const message = {
      label: labels.NORMAL_SERVER_PROCESS,
      data: {
        type: type.ROOM_EXIT.REQUEST,
        roomName: name,
        userId: id
      }
    };
    wsConnection.current?.send(JSON.stringify(message));
  };

  // WebRTC Functions
  const createPeerConnectionObject = () => {
    pc.current = new RTCPeerConnection(webRTCConfiguratons);

    pc.current.onconnectionstatechange = () => {
      console.log('Connection state:', pc.current?.connectionState);
      if (pc.current?.connectionState === 'connected') {
        Alert.alert('Success', 'WebRTC connection established!');
      }
    };

    pc.current.onsignalingstatechange = () => {
      console.log('Signaling state:', pc.current?.signalingState);
    };

    pc.current.onicecandidate = (e) => {
      if (e.candidate) {
        console.log('ICE candidate:', e.candidate);
        setIceCandidatesGenerated((prev) => [...prev, e.candidate]);
      }
    };
  };

  const createDataChannel = (isOfferor) => {
    if (isOfferor) {
      const dataChannelOptions = { ordered: false, maxRetransmits: 0 };
      dataChannel.current = pc.current?.createDataChannel('top-secret-chat-room', dataChannelOptions);
      registerDataChannelEventListeners();
    } else {
      pc.current.ondatachannel = (e) => {
        console.log('Data channel received:', e);
        dataChannel.current = e.channel;
        registerDataChannelEventListeners();
      };
    }
  };

  const registerDataChannelEventListeners = () => {
    dataChannel.current.onmessage = (e) => {
      const msg = e.data;
      const formattedMessage = addIncomingMessageToUi(msg, otherUserId);
      setMessages((prev) => [...prev, formattedMessage]);
    };

    dataChannel.current.onopen = () => {
      console.log('Data channel opened');
    };

    dataChannel.current.onclose = () => {
      console.log('Data channel closed');
    };
  };

  const startWebRTCProcess = async () => {
    createPeerConnectionObject();
    createDataChannel(true);

    try {
      const offer = await pc.current?.createOffer();
      await pc.current?.setLocalDescription(offer);
      sendOffer(pc.current?.localDescription);
    } catch (error) {
      console.error('WebRTC error:', error);
      Alert.alert('Error', 'Failed to initiate WebRTC connection.');
    }
  };

  const sendOffer = (offer) => {
    const message = {
      label: labels.WEBRTC_PROCESS,
      data: { type: type.WEB_RTC.OFFER, offer, otherUserId }
    };
    wsConnection.current?.send(JSON.stringify(message));
  };

  const sendAnswer = (answer) => {
    const message = {
      label: labels.WEBRTC_PROCESS,
      data: { type: type.WEB_RTC.ANSWER, answer, otherUserId }
    };
    wsConnection.current?.send(JSON.stringify(message));
  };

  const sendIceCandidates = (candidates) => {
    const message = {
      label: labels.WEBRTC_PROCESS,
      data: { type: type.WEB_RTC.ICE_CANDIDATES, candidatesArray: candidates, otherUserId }
    };
    wsConnection.current?.send(JSON.stringify(message));
  };

  const handleOffer = async (data) => {
    createPeerConnectionObject();
    createDataChannel(false);
    try {
      await pc.current?.setRemoteDescription(data.offer);
      const answer = await pc.current?.createAnswer();
      await pc.current?.setLocalDescription(answer);
      sendAnswer(answer);
      sendIceCandidates(iceCandidatesGenerated);
    } catch (error) {
      console.error('Error handling offer:', error);
      Alert.alert('Error', 'Failed to process WebRTC offer.');
    }
  };

  const handleAnswer = async (data) => {
    try {
      sendIceCandidates(iceCandidatesGenerated);
      await pc.current?.setRemoteDescription(data.answer);
      for (const candidate of iceCandidatesReceivedBuffer) {
        await pc.current?.addIceCandidate(candidate);
      }
      setIceCandidatesReceivedBuffer([]);
    } catch (error) {
      console.error('Error handling answer:', error);
      Alert.alert('Error', 'Failed to process WebRTC answer.');
    }
  };

  const handleIceCandidates = (data) => {
    if (pc.current?.remoteDescription) {
      try {
        data.candidatesArray.forEach((candidate) => {
          pc.current?.addIceCandidate(new RTCIceCandidate(candidate));
        });
      } catch (error) {
        console.log('Error adding ICE candidate:', error);
      }
    } else {
      setIceCandidatesReceivedBuffer((prev) => [...prev, ...data.candidatesArray.map(c => new RTCIceCandidate(c))]);
    }
  };

  const sendMessageUsingDataChannel = (msg) => {
    if (dataChannel.current?.readyState === 'open') {
      dataChannel.current.send(msg);
    } else {
      console.log('Data channel not open');
    }
  };

  const closePeerConnection = () => {
    if (pc.current) {
      pc.current.close();
      pc.current = null;
      dataChannel.current = null;
      console.log('Peer connection closed');
    }
  };

  // Server Processing
  const normalServerProcessing = (data) => {
    switch (data.type) {
      case type.ROOM_JOIN.RESPONSE_SUCCESS:
        joinSuccessHandler(data);
        break;
      case type.ROOM_JOIN.RESPONSE_FAILURE:
        console.log('Join room failed:', data.message);
        Alert.alert('Error', data.message || 'Failed to join room.');
        break;
      case type.ROOM_JOIN.NOTIFY:
        setOtherUserId(data.joinUserId);
        Alert.alert('Notification', data.message || `User ${data.joinUserId} has joined your room`);
        break;
      case type.ROOM_EXIT.NOTIFY:
      case type.ROOM_DISONNECTION.NOTIFY:
        setOtherUserId(null);
        Alert.alert('Notification', data.message || 'A user has left your room');
        closePeerConnection();
        break;
      default:
        console.log('Unknown data type:', data.type);
    }
  };

  const webRTCServerProcessing = (data) => {
    switch (data.type) {
      case type.WEB_RTC.OFFER:
        handleOffer(data);
        break;
      case type.WEB_RTC.ANSWER:
        handleAnswer(data);
        break;
      case type.WEB_RTC.ICE_CANDIDATES:
        handleIceCandidates(data);
        break;
      default:
        console.log('Unknown data type:', data.type);
    }
  };

  const joinSuccessHandler = (data) => {
    if (data.creatorId && data.creatorId !== userId) {
      setOtherUserId(data.creatorId);
    }
    setRoomName(data.roomName);
    startWebRTCProcess();
    Alert.alert('Success', data.message || 'Join room successful');
  };

  // UI Handlers
  const exitRoom = () => {
    inputRoomNameElement.current?.clear();
    setRoomName('');
    setOtherUserId(null);
    setChannelName('');
  };

  const handleCreateRoom = () => {
    const name = channelName.trim();
    setChannelName('');
    if (!name) {
      Alert.alert('Error', 'Your room needs a name');
      return;
    }
    createRoom(name, userId);
  };

  const handleDestroyRoom = () => {
    if (roomName) {
      destroyRoom(roomName);
    } else {
      Alert.alert('Error', 'No room to destroy');
    }
  };

  const handleJoinRoom = () => {
    const name = channelName.trim();
    setChannelName('');
    if (!name) {
      Alert.alert('Error', 'You have to join a room with a valid name');
      return;
    }
    joinRoom(name, userId);
  };

  const handleExitRoom = () => {
    if (roomName) {
      sendExitRoomRequest(roomName, userId);
    }
    exitRoom();
    closePeerConnection();
  };

  const handleSendMessage = () => {
    const msg = message.trim();
    setMessage('');
    if (msg) {
      const formattedMessage = addOutgoingMessageToUi(msg, userId);
      setMessages((prev) => [...prev, formattedMessage]);
      sendMessageUsingDataChannel(msg);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <Text style={styles.header}>WebRTC Chat Room</Text>

        {/* Channel Name Input */}
        <TextInput
          ref={inputRoomNameElement}
          style={styles.input}
          placeholder="Enter channel name"
          value={channelName}
          onChangeText={setChannelName}
        />

        {/* Buttons for Room Actions */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity style={styles.button} onPress={handleCreateRoom}>
            <Text style={styles.buttonText}>Create</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.button} onPress={handleJoinRoom}>
            <Text style={styles.buttonText}>Join</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.buttonContainer}>
          <TouchableOpacity style={styles.button} onPress={handleDestroyRoom}>
            <Text style={styles.buttonText}>Destroy Room</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.button} onPress={handleExitRoom}>
            <Text style={styles.buttonText}>Exit Room</Text>
          </TouchableOpacity>
        </View>

        {/* Message Input */}
        <TextInput
          style={styles.input}
          placeholder="Type a message..."
          value={message}
          onChangeText={setMessage}
        />

        {/* Send Button */}
        <TouchableOpacity style={styles.sendButton} onPress={handleSendMessage}>
          <Text style={styles.buttonText}>Send</Text>
        </TouchableOpacity>

        {/* Message Container */}
        <View style={styles.messageContainer}>
          {messages.length === 0 ? (
            <Text style={styles.noMessages}>No messages yet</Text>
          ) : (
            messages.map((msg, index) => (
              <Text key={index} style={styles.message}>
                {msg}
              </Text>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollContainer: {
    padding: 20,
    alignItems: 'center',
  },
  header: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 20,
  },
  input: {
    width: '100%',
    height: 40,
    borderColor: '#ccc',
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 10,
    marginBottom: 20,
    backgroundColor: '#fff',
  },
 购房buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 20,
  },
  button: {
    flex: 1,
    backgroundColor: '#007AFF',
    padding: 10,
    borderRadius: 5,
    alignItems: 'center',
    marginHorizontal: 5,
  },
  sendButton: {
    width: '100%',
    backgroundColor: '#007AFF',
    padding: 10,
    borderRadius: 5,
    alignItems: 'center',
    marginBottom: 20,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  messageContainer: {
    width: '100%',
    BretbackgroundColor: '#fff',
    borderRadius: 5,
    padding: 10,
    minHeight: 100,
  },
  message: {
    fontSize: 14,
    color: '#333',
    marginBottom: 5,
  },
  noMessages: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
});

export default App;
