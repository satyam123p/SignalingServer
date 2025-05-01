
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
