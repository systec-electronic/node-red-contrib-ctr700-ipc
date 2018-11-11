/****************************************************************************

  (c) SYSTEC electronic GmbH, D-08468 Heinsdorfergrund, Am Windrad 2
      www.systec-electronic.com

  Project:      OpenPCS IPC client
  Description:  JavaScript bindings to the OpenPCS IPC client

  -------------------------------------------------------------------------

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.

  -------------------------------------------------------------------------

  Revision History:

  2018/04/02 -ad:   V1.00 Initial version

****************************************************************************/


ref = require ('ref');
ffi = require ('ffi');
StructMeta = require ('ref-struct');
ArrayMeta  = require ('ref-array');


// FFI types -------------------------------------------------------------------

const t = ref.types;

const void_ptr   = ref.refType(t.void);
const uint8_ptr  = ref.refType(t.uint8);
const uint16_ptr = ref.refType(t.uint16);
const uint32_ptr = ref.refType(t.uint32);

const tIpcClient = StructMeta({
    m_pInternal: void_ptr,
});
const tIpcClientPtr = ref.refType(tIpcClient);


// FFI API --------------------------------------------------------------------

const LibIpcClient = ffi.Library(
    'libipcclient',
    {
        'IpcClientOpen':            [t.uint8, [tIpcClientPtr, t.CString, t.CString]],

        // This implementation uses the IpcClientStartProcessThread function
        // 'IpcClientProcess': [t.uint8, [tIpcClientPtr]],

        'IpcClientStartProcessThread':  [t.uint8, [tIpcClientPtr, t.uint32]],

        'IpcClientSubscribe':       [t.uint8, [tIpcClientPtr, t.CString]],

        'IpcClientVarGetType':      [t.uint8, [tIpcClientPtr, t.CString, uint8_ptr]],

        'IpcClientVarGet':          [t.uint8, [tIpcClientPtr, t.CString, uint8_ptr, t.uint32, uint32_ptr]],

        'IpcClientVarSet':          [t.uint8, [tIpcClientPtr, t.CString, uint8_ptr, t.uint32]],

        'IpcClientGetServerState':  [t.uint8, [tIpcClientPtr, uint8_ptr]],

        'IpcClientClose':           [t.uint8, [tIpcClientPtr]],

        'IpcCommonErrorToString':   [t.CString, [t.uint8]],
    }
);

const IpcResult = {
    SUCCESS: 0x00,
    ERROR_INVALIDARGUMENT: 0x01,

    ERROR_UDSSOCKET_CREATION: 0x11,
    ERROR_UDSSOCKET_BIND: 0x12,
    ERROR_UDSSOCKET_CONNECT: 0x13,
    ERROR_UDSSOCKET_SEND: 0x14,
    ERROR_UDSSOCKET_RECV: 0x15,

    ERROR_FRAME_INVALID: 0x21,
    ERROR_FRAME_BUFFERTOSMALL: 0x22,

    ERROR_CLIENT_PENDING: 0x31,
    ERROR_CLIENT_TIMEOUT: 0x32,
    ERROR_CLIENT_PROTOCOL: 0x33,
    ERROR_CLIENT_BUFFERTOSMALL: 0x34,
    ERROR_CLIENT_SUBSCRIBE: 0x35,
    ERROR_CLIENT_NOTSUBSCRIBED: 0x36,
    ERROR_CLIENT_NOTEXIST: 0x37,
    ERROR_CLIENT_INVALIDTYPE: 0x38,
    ERROR_CLIENT_THREADSTART: 0x39,

    ERROR_SERVER_PROTOCOL: 0x41,
    ERROR_SERVER_BUFFERTOSMALL: 0x42,
}


// Public API -----------------------------------------------------------------

/**
 * Checks the result code of an FFI function. If the result code represents an
 * error, it will throw an IpcException
 *
 * @param resultCode
 *            The result code to check
 */
function _checkResult(resultCode) {
    if (resultCode == IpcResult.SUCCESS) {
        return
    } else {
        let message = LibIpcClient.IpcCommonErrorToString(resultCode);
        throw new IpcException(message, resultCode);
    }
}

/**
 * Custom exception type for IPC errors
 */
class IpcException extends Error {
    /**
     * Default constructor
     *
     * @param message
     *            Error message of the exception
     * @param errorCode
     *            Error code from the called FFI function
     */
    constructor (message, errorCode) {
        super()
        Error.captureStackTrace(this, this.constructor);

        this.code = errorCode;
        this.message = message;
    }

    /**
     * @return Signals, if the exception represents a pending operation.
     */
    isOperationPending() {
        return this.code === IpcResult.ERROR_CLIENT_PENDING;
    }

    /**
     * Compare the exception with another one by comparing its message and
     * result code.
     */
    isEqual(otherException) {
        if (otherException === null) {
            return false;
        }

        if (!otherException instanceof IpcException) {
            return false;
        }

        return (this.code == otherException.code)
            && (this.message == otherException.message)
    }
}


class IpcClient {
     /**
         * Create and open a new IPC client.
         *
         * <b>HINT</b>: Never create new clients with the same socket paths.
         * This would lead to undefined behavior!
         *
         * @param requestPath
         *            Path to the socket for requests (IPC client -> IPC server)
         * @param responsePath
         *            Path to the socket for responses (IPC server -> IPC
         *            client)
         * @param pollTime
         *            This time specifies the poll/update time for asynchronous
         *            functions and background threads.
         */
    constructor(requestPath, responsePath, pollTime) {
        this._ipcclient = new tIpcClient();

        this._variableSubscriptions = new Set();
        this._variableSubscriptionsToDelete = new Set();

        this._eventSubscriptions = new Set();
        this._eventSubscriptionsToDelete = new Set();

        this._pollTime = pollTime;

        this._open(requestPath, responsePath)
    }

    /**
     * Open the IPC client instance, this has to be once before calling any of
     * the other functions of this class.
     *
     * @param requestSockPath
     *            Path to the socket for requests (IPC client -> IPC server)
     * @param responseSockPath
     *            Path to the socket for responses (IPC server -> IPC client)
     */
    _open(requestPath, responsePath) {
        let result = LibIpcClient.IpcClientOpen(
            this._ipcclient.ref(), requestPath, responsePath);
        _checkResult(result);

        result = LibIpcClient.IpcClientStartProcessThread(
            this._ipcclient.ref(), this._pollTime)
        _checkResult(result);
    }

    /**
     * This function registers a new variable to the client. This is needed
     * before any operation to the variable is possible.
     *
     * @param variable
     *            The variable to register
     */
    register(variable) {
        const result = LibIpcClient.IpcClientSubscribe(
            this._ipcclient.ref(), variable.name());
        _checkResult(result);

        variable._setClient(this);
    }

    /**
     * Check if the remote server is running currently.
     *
     * @return state of the IPC server
     */
    isServerRunning() {
        const state = ref.alloc('uint8');
        const result = LibIpcClient.IpcClientGetServerState(
            this._ipcclient.ref(), state);
        _checkResult(result);

        return state.deref() != 0;
    }

    /**
     * Closes the client instance and stops any background tasks and
     * subscriptions.
     */
    close() {
        if (this._ipcclient === undefined) {
            return;
        }

        this._stopSubscriptions();

        this._variableSubscriptions.clear();
        this._variableSubscriptionsToDelete.clear();
        this._eventSubscriptions.clear();
        this._eventSubscriptionsToDelete.clear();

        const result = LibIpcClient.IpcClientClose(this._ipcclient.ref());
        _checkResult(result);

        delete this._ipcclient
    }

    /**
     * Subscribe a event subscriber to the client.
     *
     * Hint: Callback function will be bound to the subscription. The 'this'
     * reference inside a callback function references the subscription itself.
     *
     * @param subscription
     *            The new subscription callback
     */
    subscribeEvents(callback) {
        this._eventSubscriptions.add(callback);
        this._startStopSubscriptions();
        return callback;
    }

    /**
     * Un-subscribe an event subscriber from the client.
     *
     * Hint: Callback function will be bound to the subscription. The 'this'
     * reference inside a callback function references the subscription itself.
     *
     * @param subscription
     *            The new subscription, which should be removed
     */
    unsubscribeEvents(callback) {
        this._eventSubscriptionsToDelete.add(callback);
        this._startStopSubscriptions();
    }

    /**
     * Get the type information of a variable in an synchronous way. This
     * operation may take multiple cycles of the OpenPCS runtime system.
     *
     * @param   The name of the variable
     * @returns A object with the following members:
     *              - jstype: The corresponding JavaScript type
     */
    getVariableClassSync(variableName, timeout) {
        const result = LibIpcClient.IpcClientSubscribe(
            this._ipcclient.ref(), variableName);
        _checkResult(result);

        const timeoutExpire = (new Date().valueOf()) + timeout;

        while (timeoutExpire > (new Date().valueOf())) {
            try {
                const typecode = this._getType(variableName);
                for (const [typeClass, typeInfo] of TYPE_MAP) {
                     if (typeInfo.code === typecode) {
                         return typeClass;
                    }
                }
            } catch (err) {
                if ((err instanceof IpcException) && (err.isOperationPending())) {
                    continue;
                }
                throw err;
            }
        }

        const resultCode = IpcResult.ERROR_CLIENT_TIMEOUT;
        const message = LibIpcClient.IpcCommonErrorToString(resultCode);
        throw new IpcException(message, resultCode);
    }

    /**
     * Get the type of a variable
     *
     * @param variableName
     *            The type code of the variable (@see TYPE_MAP)
     */
    _getType(variableName) {
        const type = ref.alloc('uint8');

        const result = LibIpcClient.IpcClientVarGetType(
            this._ipcclient.ref(), variableName, type);
        _checkResult(result);

        return type.deref();
    }

    /**
     * Get the current value of a variable and write it to the given buffer.
     *
     * @param variableName
     *            The identifier of the variable
     * @param buffer
     *            The buffer to write the date into
     */
    _get(variableName, buffer) {
        const actualBytes = ref.alloc('uint16');

        const result = LibIpcClient.IpcClientVarGet(
            this._ipcclient.ref(),
            variableName, buffer, buffer.length, actualBytes);
        _checkResult(result);
    }

    /**
     * Set the value of a variable.
     *
     * @param variableName
     *            The identifier of the variable
     * @param buffer
     *            The buffer which holds the new value data
     * @param size
     *            The size of the data to write
     */
    _set(variableName, buffer) {
        const result = LibIpcClient.IpcClientVarSet(
            this._ipcclient.ref(),
            variableName, buffer, buffer.length);
        _checkResult(result);
    }

    /**
     * Subscribe to a single variable. Subscriptions will be handled by the
     * `subscriptionThread`
     *
     * @param variable
     *            The variable to subscribe
     */
    _subscribeVar(variable) {
        this._variableSubscriptions.add(variable);
        this._startStopSubscriptions();
    }

    /**
     * Un-subscribe a single variable from the client.
     *
     * @param variable
     *            The variable to un-subscribe
     */
    _unsubscribeVar(variable) {
        this._variableSubscriptionsToDelete.add(variable);
        this._startStopSubscriptions();
    }

    /**
     * Start subscription handling if there are any subscriptions, if not it
     * will stop handling as necessary.
     */
    _startStopSubscriptions() {
        if ((this._eventSubscriptions.size === 0)
            && (this._variableSubscriptions.size === 0)) {
            this._stopSubscriptions();
        } else {
            if (typeof this._subscriptionIntervallId === "undefined") {
                this._startSubscriptions();
            }
        }
    }

    /**
     * Start subscription handling
     */
    _startSubscriptions() {
        this._subscriptionContext = {
            serverState: false,
            serverStateLast: this.isServerRunning()
        };

        function _handleSubscriptions() {
            const context = this._subscriptionContext;
            context.serverState = this.isServerRunning();

            this._eventSubscriptionsToDelete.forEach((callback) => {
                this._eventSubscriptions.delete(callback);
            });
            this._eventSubscriptionsToDelete.clear();

            this._variableSubscriptionsToDelete.forEach((callback) => {
                this._variableSubscriptions.delete(callback);
            });
            this._variableSubscriptionsToDelete.clear();

            this._startStopSubscriptions();

            if (context.serverState != context.serverStateLast) {
                this._eventSubscriptions.forEach((callback) => {
                    const cb = callback.bind(callback);
                    cb(context.serverState ? "START" : "STOP");
                });

                context.serverStateLast = context.serverState;
            }

            if (context.serverState) {
                this._variableSubscriptions.forEach((variable) => {
                    variable._processSubscriptions();
                });
            }
        }
        _handleSubscriptions = _handleSubscriptions.bind(this);

        this._subscriptionIntervallId = setInterval(_handleSubscriptions,
            this._pollTime);
    }

    /**
     * Stop subscription handling
     */
    _stopSubscriptions() {
        clearInterval(this._subscriptionIntervallId);
        delete this._subscriptionIntervallId;
    }

}

/**
 * This abstract class defines the basic interface of all supported variable
 * types. A variable must be registered to an IpcClient to get or set the value
 * or register a subscription to it.
 */
class IpcVar {
    /**
     * Constructor of a new variable object.
     *
     * @param variableName
     *            The name/identifier of the variable
     */
    constructor(variableName) {
        this._name = variableName;
        this._client = null;

        this._lastValue = null;
        this._lastException = null;

        this._typeSubscriptions = new Set();

        this._subscriptions = new Set();
        this._subscriptionsToDelete = new Set();
    }

    /**
     * Get name of the variable
     *
     * @return The name
     */
    name() {
        return this._name;
    }

    /**
     * Register a callback, which will be called as soon as the type of the
     * variable has been checked. If the type check was successful, the
     * variable can then be used for writing values to it.
     *
     * @param callback: The callback function with three parameters:
     *              variable: IpcVar  - The variable, which has been checked
     *              match:    boolean - true, if the types match
     *              error:    IpcException - If the type check was successful
     *                                  this parameters is 'undefined'. Otherwise
     *                                  an exception, which describes the error
     *                                  is given.
     */
    subscribeTypeMatch(callback) {
        this._typeSubscriptions.add(callback);
        this._client._subscribeVar(this);
    }

    /**
     * Get type info of a variable
     *
     * @return The type info from
     * @see TYPE_MAP
     */
    _type() {
        return TYPE_MAP.get(this.constructor);
    }

    /**
     * Check if the type of the class and the type of the PLC program match
     */
    _checkType() {
        const type = this._client._getType(this._name);
        if (type !== this._type().code) {
            throw new IpcException("Variable type does not match");
        }
    }

    /**
     * Check if the given value matches the variable type
     */
    _checkTypeOfValue(value) {
        const jstype = this._type().jstype;

        if (typeof value !== jstype) {
            throw new RangeError("Value has invalid type. '" + jstype + "' expected!");
        }
    }

    /**
     * Subscribe to events regarding this variable
     *
     * @param onValueChange
     *            The callback for a value change
     * @param onError
     *            The callback for an error during handling the subscription
     * @returns A subscription object, which can be used for unregister()
     */
    subscribe(onValueChange, onError) {
        const subscription = {
            onValueChange: onValueChange,
            onError: onError,
        };

        this._subscriptions.add(subscription);
        this._client._subscribeVar(this);

        return subscription;
    }

    /**
     * Un-subscribe to events regarding this variable
     *
     * @param subscription
     *            The subscription to un-subscribe
     */
    unsubscribe(subscription) {
        this._subscriptionsToDelete.add(subscription);
    }

    /**
     * Get the value of this variable. This method may throw an IpcException in
     * two different scenarios. (1) a real error occurred / (2) The variable
     * read request has not completed yet. In the latter case the
     * isOperationPending() method can be used to identify such kind of an
     * error.
     *
     * @return The current value of the variable
     */
    get()            { throw new Error("Abstract method!"); }

    /**
     * Set the value of the variable. The value will not be updated immediately.
     * Instead a set-request will be sent to the server and the variables value
     * will be invalidated. This means the variable will return in a 'pending'
     * state until the next read-request-response cycle has completed.
     *
     * @param value
     *            The value to set
     */
    set(value)       { throw new Error("Abstract method!"); }

    /**
     * This method is a convenience wrapper for the get() method. It will
     * handle the check for an exception which signals a pending operation.
     * It will repeatedly try to get the value until the timeout occurred,
     * an 'hard' error was returned by underlying functionality or the the
     * value has successfully read.
     *
     * The function may not return immediately after the timeout. Since it
     * will re-try to get the value in the poll time of the client.
     *
     * @param timeout
     *            Timeout of the get function in ms
     * @return The value of the client
     */
    getSync(timeout) {
        const timeoutExpire = (new Date().valueOf()) + timeout;

        while (timeoutExpire > (new Date().valueOf())) {
            try {
                const value = this.get();
                return value;
            } catch (err) {
                if ((err instanceof IpcException) && (err.isOperationPending())) {
                    continue;
                }
                throw err;
            }
        }

        const resultCode = IpcResult.ERROR_CLIENT_TIMEOUT;
        const message = LibIpcClient.IpcCommonErrorToString(resultCode);
        throw new IpcException(message, message);
    }

    /**
     * Set the client instance of a variable. This is called by the client,
     * when a new variable will be registered.
     *
     * @param client
     *            The client to set
     */
    _setClient(client) {
        this._client = client;
    }

    /**
     * Process all subscriptions of this variable.
     */
    _processSubscriptions() {

        if (this._typeSubscriptions.size > 0) {
            let success = undefined;
            let exception = undefined;

            try {
                this._checkType();
                success = true;
            } catch (err) {
                if (!(err instanceof IpcException) ||
                    !(err.isOperationPending())) {
                    success = false;
                    exception = err;
                }
            }

            if (typeof success !== 'undefined') {
                const variable = this;
                this._typeSubscriptions.forEach(function(callback) {
                    callback(variable, success, exception);
                });
                this._typeSubscriptions.clear();
            }
        }

        this._subscriptionsToDelete.forEach((subscription) => {
            this._subscriptions.delete(subscription)
        });
        this._subscriptionsToDelete.clear();

        if ((this._typeSubscriptions.size === 0) &&
            (this._subscriptions.size === 0)) {
            this._client._unsubscribeVar(this);
        }

        if (this._subscriptions.size === 0) {
            return;
        }

        let value = null;
        let exception = null;

        try {
            value = this.get();
        } catch (err) {
            if (!(err instanceof IpcException) || !err.isOperationPending()) {
                exception = err;
            }
        }

        if ((value != null) && (value !== this._lastValue)) {
            this._subscriptions.forEach((subscription) => {
                const cb = subscription.onValueChange.bind(subscription);
                cb(this, value);
            });
        }

        if ((exception != null) && (exception instanceof IpcException)
                && !exception.isEqual(this._lastException)) {
            this._subscriptions.forEach((subscription) => {
                const cb = subscription.onError.bind(subscription);
                cb(this, exception);
            });
        }

        this._lastValue = value;
        this._lastException = exception;
    }
}

/**
 * Concrete variable class for STRING variables
 *
 * @see IpcVar
 */
class IpcVarString extends IpcVar {
    get() {
        this._checkType();

        const buffer = new Buffer(250)
        this._client._get(this._name, buffer);
        return buffer.readCString();
    }

    set(value) {
        this._checkTypeOfValue(value);

        const buffer = ref.allocCString(value);
        if (buffer.length > 250)  {
            throw new RangeError(
                "The specified value is outside the types possible value range!");
        }

        this._checkType();
        this._client._set(this._name, buffer);
    }
}

/**
 * Abstract base class for primitive (numeric & boolean) variables
 *
 * @see IpcVar
 */
class IpcVarPrimitive extends IpcVar {
    get() {
        this._checkType();

        const buffer = ref.alloc(this._type().reftype);
        this._client._get(this._name, buffer);

        // convert from network byte order
        if (buffer.length == 4) {
            buffer.swap32();
        } else if (buffer.length == 2) {
            buffer.swap16();
        }

        return ref.get(buffer);
    }

    set(value) {
        this._checkType();

        const buffer = ref.alloc(this._type().reftype);
        ref.set(buffer, 0, value);

        // convert to network byte order
        if (buffer.length == 4) {
            buffer.swap32();
        } else if (buffer.length == 2) {
            buffer.swap16();
        }

        this._client._set(this._name, buffer);
    }
}

/**
 * Concrete variable class for BOOL variables
 *
 * @see IpcVar
 */
class IpcVarBool extends IpcVarPrimitive {
    get() {
        return (super.get() != 0) ? true : false;
    }

    set(value) {
        this._checkTypeOfValue(value);
        super.set(value ? 0xff: 0x00);
    }
}

/**
 * Abstract base class for numeric variables
 *
 * @see IpcVar
 */
class IpcVarNumeric extends IpcVarPrimitive {
    set(value) {
        this._checkTypeOfValue(value);

        const type = this._type();
        if ((value < type.min) || (value > type.max)) {
            throw new RangeError(
                "The specified value is outside the types possible value range!");
        }

        super.set(value)
    }
}

/**
 * Concrete variable class for BYTE variables
 *
 * @see IpcVar
 */
class IpcVarByte  extends IpcVarNumeric {}

/**
 * Concrete variable class for WORD variables
 *
 * @see IpcVar
 */
class IpcVarWord  extends IpcVarNumeric {}

/**
 * Concrete variable class for DWORD variables
 *
 * @see IpcVar
 */
class IpcVarDWord extends IpcVarNumeric {}

/**
 * Concrete variable class for USINT variables
 *
 * @see IpcVar
 */
class IpcVarUSInt extends IpcVarNumeric {}

/**
 * Concrete variable class for UINT variables
 *
 * @see IpcVar
 */
class IpcVarUInt  extends IpcVarNumeric {}

/**
 * Concrete variable class for UDINT variables
 *
 * @see IpcVar
 */
class IpcVarUDInt extends IpcVarNumeric {}

/**
 * Concrete variable class for SINT variables
 *
 * @see IpcVar
 */
class IpcVarSInt  extends IpcVarNumeric {}

/**
 * Concrete variable class for INT variables
 *
 * @see IpcVar
 */
class IpcVarInt   extends IpcVarNumeric {}

/**
 * Concrete variable class for DINT variables
 *
 * @see IpcVar
 */
class IpcVarDInt  extends IpcVarNumeric {}

/**
 * Concrete variable class for REAL variables
 *
 * @see IpcVar
 */
class IpcVarReal  extends IpcVarPrimitive {
    set(value) {
        this._checkTypeOfValue(value);
        super.set(value);
    }
}

const TYPE_MAP = new Map([
    [ IpcVarBool,   { code: 1,  jstype: "boolean", reftype: "uint8" } ],
    [ IpcVarByte,   { code: 2,  jstype: "number",  reftype: "uint8",  min: 0,           max: 255        } ],
    [ IpcVarWord,   { code: 3,  jstype: "number",  reftype: "uint16", min: 0,           max: 65535      } ],
    [ IpcVarDWord,  { code: 4,  jstype: "number",  reftype: "uint32", min: 0,           max: 4294967295 } ],
    [ IpcVarUSInt,  { code: 5,  jstype: "number",  reftype: "uint8",  min: 0,           max: 255        } ],
    [ IpcVarUInt,   { code: 6,  jstype: "number",  reftype: "uint16", min: 0,           max: 65535      } ],
    [ IpcVarUDInt,  { code: 7,  jstype: "number",  reftype: "uint32", min: 0,           max: 4294967295 } ],
    [ IpcVarSInt,   { code: 8,  jstype: "number",  reftype: "int8",   min: -128,        max: 127        } ],
    [ IpcVarInt,    { code: 9,  jstype: "number",  reftype: "int16",  min: -32768,      max: 32767      } ],
    [ IpcVarDInt,   { code: 10, jstype: "number",  reftype: "int32",  min: -2147483648, max: 2147483647 } ],
    [ IpcVarReal,   { code: 11, jstype: "number",  reftype: "float" } ],
    [ IpcVarString, { code: 20, jstype: "string" } ],
]);


/**
 * Singleton wrapper for the IpcClient class
 */
class IpcClientSingleton extends IpcClient {
    constructor(requestPath, responsePath, pollTime) {
        if (typeof IpcClientSingleton._instanceCount === 'undefined') {
            IpcClientSingleton._instanceCount = 0;
        }

        if (typeof IpcClientSingleton._instance === 'undefined') {
            IpcClientSingleton._requestPath = requestPath;
            IpcClientSingleton._responsePath = responsePath;
            IpcClientSingleton._pollTime = pollTime;

            IpcClientSingleton._instance = super(requestPath, responsePath, pollTime);
        } else {
            if ((IpcClientSingleton._requestPath !== requestPath)
             || (IpcClientSingleton._responsePath !== responsePath)
             || (IpcClientSingleton._pollTime !== pollTime)) {
                throw new Error("Constructor settings must be the same for"
                    + " all instances of the singleton instance!");
            }

        }

        IpcClientSingleton._instanceCount++;
        return IpcClientSingleton._instance;
    }

    close() {
        IpcClientSingleton._instanceCount--;

        if (IpcClientSingleton._instanceCount === 0) {
            super.close();
            delete(IpcClientSingleton._instance);
        }

        if (IpcClientSingleton._instanceCount < 0) {
            throw new Error("Close has been called to often!");
        }
    }
}

// Export public types
module.exports = {
    IpcClient,
    IpcClientSingleton,
    IpcException,
    IpcVarString,
    IpcVarBool,
    IpcVarByte,
    IpcVarWord,
    IpcVarDWord,
    IpcVarUSInt,
    IpcVarUInt,
    IpcVarUDInt,
    IpcVarSInt,
    IpcVarInt,
    IpcVarDInt,
    IpcVarReal,
}
