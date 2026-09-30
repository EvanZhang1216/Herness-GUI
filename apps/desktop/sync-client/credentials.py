"""Windows user-scoped DPAPI; independent of Chromium's per-profile encryption key."""
import base64
import ctypes
import json
import sys
from ctypes import wintypes


class Blob(ctypes.Structure):
    _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_ubyte))]


def protect(mode, value):
    raw = value.encode('utf-8') if mode == 'encrypt' else base64.b64decode(value, validate=True)
    memory = ctypes.create_string_buffer(raw)
    source = Blob(len(raw), ctypes.cast(memory, ctypes.POINTER(ctypes.c_ubyte)))
    output = Blob()
    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    function = crypt.CryptProtectData if mode == 'encrypt' else crypt.CryptUnprotectData
    function.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p,
                         ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    function.restype = wintypes.BOOL
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    if not function(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(output)):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        result = ctypes.string_at(output.data, output.size)
        return base64.b64encode(result).decode('ascii') if mode == 'encrypt' else result.decode('utf-8')
    finally:
        ctypes.memset(output.data, 0, output.size)
        kernel.LocalFree(output.data)


if __name__ == '__main__':
    data = json.load(sys.stdin)
    if data['mode'] not in ('encrypt', 'decrypt'):
        raise ValueError('Unknown credential operation')
    print(json.dumps({'value': protect(data['mode'], data['value'])}))
