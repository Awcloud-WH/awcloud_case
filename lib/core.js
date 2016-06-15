//(function(window) {'use strict';

function minErr(module, ErrorConstructor) {
	ErrorConstructor = ErrorConstructor || Error;
	return function() {
		var SKIP_INDEXES = 2;

		var templateArgs = arguments,
			code = templateArgs[0],
			message = '[' + (module ? module + ':' : '') + code + '] ',
			template = templateArgs[1],
			paramPrefix, i;

		message += template.replace(/\{\d+\}/g, function(match) {
			var index = +match.slice(1, -1),
				shiftedIndex = index + SKIP_INDEXES;

			if (shiftedIndex < templateArgs.length) {
				return toDebugString(templateArgs[shiftedIndex]);
			}

			return match;
		});

		message += '\nhttp://errors.angularjs.org/1.5.6/' +
			(module ? module + '/' : '') + code;

		for (i = SKIP_INDEXES, paramPrefix = '?'; i < templateArgs.length; i++, paramPrefix = '&') {
			message += paramPrefix + 'p' + (i - SKIP_INDEXES) + '=' +
				encodeURIComponent(toDebugString(templateArgs[i]));
		}

		return new ErrorConstructor(message);
	};
}

////////////////////////////////////

var REGEX_STRING_REGEXP = /^\/(.+)\/([a-z]*)$/;

// The name of a form control's ValidityState property.
// This is used so that it's possible for internal tests to create mock ValidityStates.
var VALIDITY_STATE_PROPERTY = 'validity';

var hasOwnProperty = Object.prototype.hasOwnProperty;

var lowercase = function(string) {return isString(string) ? string.toLowerCase() : string;};
var uppercase = function(string) {return isString(string) ? string.toUpperCase() : string;};

var manualLowercase = function(s) {

	return isString(s)
			? s.replace(/[A-Z]/g, function(ch) {return String.fromCharCode(ch.charCodeAt(0) | 32);})
			: s;
};
var manualUppercase = function(s) {

	return isString(s)
			? s.replace(/[a-z]/g, function(ch) {return String.fromCharCode(ch.charCodeAt(0) & ~32);})
			: s;
};

// String#toLowerCase and String#toUpperCase don't produce correct results in browsers with Turkish
// locale, for this reason we need to detect this case and redefine lowercase/uppercase methods
// with correct but slower alternatives. See https://github.com/angular/angular.js/issues/11387
if ('i' !== 'I'.toLowerCase()) {
	lowercase = manualLowercase;
	uppercase = manualUppercase;
}

var
		msie,             // holds major version number for IE, or NaN if UA is not IE.
		jqLite,           // delay binding since jQuery could be loaded after us.
		jQuery,           // delay binding
		slice             = [].slice,
		splice            = [].splice,
		push              = [].push,
		toString          = Object.prototype.toString,
		getPrototypeOf    = Object.getPrototypeOf,
		ngMinErr          = minErr('ng'),

		angular           = window.angular || (window.angular = {}),
		angularModule,
		uid               = 0;

msie = window.document.documentMode;

function isArrayLike(obj) {

	// `null`, `undefined` and `window` are not array-like
	if (obj == null || isWindow(obj)) return false;

	// arrays, strings and jQuery/jqLite objects are array like
	// * jqLite is either the jQuery or jqLite constructor function
	// * we have to check the existence of jqLite first as this method is called
	//   via the forEach method when constructing the jqLite object in the first place
	if (isArray(obj) || isString(obj) || (jqLite && obj instanceof jqLite)) return true;

	// Support: iOS 8.2 (not reproducible in simulator)
	// "length" in obj used to prevent JIT error (gh-11508)
	var length = "length" in Object(obj) && obj.length;

	// NodeList objects (with `item` method) and
	// other objects with suitable length characteristics are array-like
	return isNumber(length) &&
		(length >= 0 && ((length - 1) in obj || obj instanceof Array) || typeof obj.item == 'function');

}

function forEach(obj, iterator, context) {
	var key, length;
	if (obj) {
		if (isFunction(obj)) {
			for (key in obj) {
				// Need to check if hasOwnProperty exists,
				// as on IE8 the result of querySelectorAll is an object without a hasOwnProperty function
				if (key != 'prototype' && key != 'length' && key != 'name' && (!obj.hasOwnProperty || obj.hasOwnProperty(key))) {
					iterator.call(context, obj[key], key, obj);
				}
			}
		} else if (isArray(obj) || isArrayLike(obj)) {
			var isPrimitive = typeof obj !== 'object';
			for (key = 0, length = obj.length; key < length; key++) {
				if (isPrimitive || key in obj) {
					iterator.call(context, obj[key], key, obj);
				}
			}
		} else if (obj.forEach && obj.forEach !== forEach) {
				obj.forEach(iterator, context, obj);
		} else if (isBlankObject(obj)) {
			// createMap() fast path --- Safe to avoid hasOwnProperty check because prototype chain is empty
			for (key in obj) {
				iterator.call(context, obj[key], key, obj);
			}
		} else if (typeof obj.hasOwnProperty === 'function') {
			// Slow path for objects inheriting Object.prototype, hasOwnProperty check needed
			for (key in obj) {
				if (obj.hasOwnProperty(key)) {
					iterator.call(context, obj[key], key, obj);
				}
			}
		} else {
			// Slow path for objects which do not have a method `hasOwnProperty`
			for (key in obj) {
				if (hasOwnProperty.call(obj, key)) {
					iterator.call(context, obj[key], key, obj);
				}
			}
		}
	}
	return obj;
}

function forEachSorted(obj, iterator, context) {
	var keys = Object.keys(obj).sort();
	for (var i = 0; i < keys.length; i++) {
		iterator.call(context, obj[keys[i]], keys[i]);
	}
	return keys;
}

function reverseParams(iteratorFn) {
	return function(value, key) {iteratorFn(key, value);};
}

function nextUid() {
	return ++uid;
}

function setHashKey(obj, h) {
	if (h) {
		obj.$$hashKey = h;
	} else {
		delete obj.$$hashKey;
	}
}

function baseExtend(dst, objs, deep) {
	var h = dst.$$hashKey;

	for (var i = 0, ii = objs.length; i < ii; ++i) {
		var obj = objs[i];
		if (!isObject(obj) && !isFunction(obj)) continue;
		var keys = Object.keys(obj);
		for (var j = 0, jj = keys.length; j < jj; j++) {
			var key = keys[j];
			var src = obj[key];

			if (deep && isObject(src)) {
				if (isDate(src)) {
					dst[key] = new Date(src.valueOf());
				} else if (isRegExp(src)) {
					dst[key] = new RegExp(src);
				} else if (src.nodeName) {
					dst[key] = src.cloneNode(true);
				} else if (isElement(src)) {
					dst[key] = src.clone();
				} else {
					if (!isObject(dst[key])) dst[key] = isArray(src) ? [] : {};
					baseExtend(dst[key], [src], true);
				}
			} else {
				dst[key] = src;
			}
		}
	}

	setHashKey(dst, h);
	return dst;
}

function extend(dst) {
	return baseExtend(dst, slice.call(arguments, 1), false);
}

function merge(dst) {
	return baseExtend(dst, slice.call(arguments, 1), true);
}

function toInt(str) {
	return parseInt(str, 10);
}

function inherit(parent, extra) {
	return extend(Object.create(parent), extra);
}

function noop() {}
noop.$inject = [];

function identity($) {return $;}
identity.$inject = [];

function valueFn(value) {return function valueRef() {return value;};}

function hasCustomToString(obj) {
	return isFunction(obj.toString) && obj.toString !== toString;
}

function isUndefined(value) {return typeof value === 'undefined';}

function isDefined(value) {return typeof value !== 'undefined';}

function isObject(value) {
	// http://jsperf.com/isobject4
	return value !== null && typeof value === 'object';
}

function isBlankObject(value) {
	return value !== null && typeof value === 'object' && !getPrototypeOf(value);
}

function isString(value) {return typeof value === 'string';}

function isNumber(value) {return typeof value === 'number';}

function isDate(value) {
	return toString.call(value) === '[object Date]';
}

var isArray = Array.isArray;

function isFunction(value) {return typeof value === 'function';}

function isRegExp(value) {
	return toString.call(value) === '[object RegExp]';
}

function isWindow(obj) {
	return obj && obj.window === obj;
}

function isScope(obj) {
	return obj && obj.$evalAsync && obj.$watch;
}

function isFile(obj) {
	return toString.call(obj) === '[object File]';
}

function isFormData(obj) {
	return toString.call(obj) === '[object FormData]';
}

function isBlob(obj) {
	return toString.call(obj) === '[object Blob]';
}

function isBoolean(value) {
	return typeof value === 'boolean';
}

function isPromiseLike(obj) {
	return obj && isFunction(obj.then);
}

var TYPED_ARRAY_REGEXP = /^\[object (?:Uint8|Uint8Clamped|Uint16|Uint32|Int8|Int16|Int32|Float32|Float64)Array\]$/;
function isTypedArray(value) {
	return value && isNumber(value.length) && TYPED_ARRAY_REGEXP.test(toString.call(value));
}

function isArrayBuffer(obj) {
	return toString.call(obj) === '[object ArrayBuffer]';
}

var trim = function(value) {
	return isString(value) ? value.trim() : value;
};

// Copied from:
// http://docs.closure-library.googlecode.com/git/local_closure_goog_string_string.js.source.html#line1021
// Prereq: s is a string.
var escapeForRegexp = function(s) {
	return s.replace(/([-()\[\]{}+?*.$\^|,:#<!\\])/g, '\\$1').
					 replace(/\x08/g, '\\x08');
};

function isElement(node) {
	return !!(node &&
		(node.nodeName  // We are a direct element.
		|| (node.prop && node.attr && node.find)));  // We have an on and find method part of jQuery API.
}

function makeMap(str) {
	var obj = {}, items = str.split(','), i;
	for (i = 0; i < items.length; i++) {
		obj[items[i]] = true;
	}
	return obj;
}

function nodeName_(element) {
	return lowercase(element.nodeName || (element[0] && element[0].nodeName));
}

function includes(array, obj) {
	return Array.prototype.indexOf.call(array, obj) != -1;
}

function arrayRemove(array, value) {
	var index = array.indexOf(value);
	if (index >= 0) {
		array.splice(index, 1);
	}
	return index;
}

function copy(source, destination) {
	var stackSource = [];
	var stackDest = [];

	if (destination) {
		if (isTypedArray(destination) || isArrayBuffer(destination)) {
			throw ngMinErr('cpta', "Can't copy! TypedArray destination cannot be mutated.");
		}
		if (source === destination) {
			throw ngMinErr('cpi', "Can't copy! Source and destination are identical.");
		}

		// Empty the destination object
		if (isArray(destination)) {
			destination.length = 0;
		} else {
			forEach(destination, function(value, key) {
				if (key !== '$$hashKey') {
					delete destination[key];
				}
			});
		}

		stackSource.push(source);
		stackDest.push(destination);
		return copyRecurse(source, destination);
	}

	return copyElement(source);

	function copyRecurse(source, destination) {
		var h = destination.$$hashKey;
		var key;
		if (isArray(source)) {
			for (var i = 0, ii = source.length; i < ii; i++) {
				destination.push(copyElement(source[i]));
			}
		} else if (isBlankObject(source)) {
			// createMap() fast path --- Safe to avoid hasOwnProperty check because prototype chain is empty
			for (key in source) {
				destination[key] = copyElement(source[key]);
			}
		} else if (source && typeof source.hasOwnProperty === 'function') {
			// Slow path, which must rely on hasOwnProperty
			for (key in source) {
				if (source.hasOwnProperty(key)) {
					destination[key] = copyElement(source[key]);
				}
			}
		} else {
			// Slowest path --- hasOwnProperty can't be called as a method
			for (key in source) {
				if (hasOwnProperty.call(source, key)) {
					destination[key] = copyElement(source[key]);
				}
			}
		}
		setHashKey(destination, h);
		return destination;
	}

	function copyElement(source) {
		// Simple values
		if (!isObject(source)) {
			return source;
		}

		// Already copied values
		var index = stackSource.indexOf(source);
		if (index !== -1) {
			return stackDest[index];
		}

		if (isWindow(source) || isScope(source)) {
			throw ngMinErr('cpws',
				"Can't copy! Making copies of Window or Scope instances is not supported.");
		}

		var needsRecurse = false;
		var destination = copyType(source);

		if (destination === undefined) {
			destination = isArray(source) ? [] : Object.create(getPrototypeOf(source));
			needsRecurse = true;
		}

		stackSource.push(source);
		stackDest.push(destination);

		return needsRecurse
			? copyRecurse(source, destination)
			: destination;
	}

	function copyType(source) {
		switch (toString.call(source)) {
			case '[object Int8Array]':
			case '[object Int16Array]':
			case '[object Int32Array]':
			case '[object Float32Array]':
			case '[object Float64Array]':
			case '[object Uint8Array]':
			case '[object Uint8ClampedArray]':
			case '[object Uint16Array]':
			case '[object Uint32Array]':
				return new source.constructor(copyElement(source.buffer));

			case '[object ArrayBuffer]':
				//Support: IE10
				if (!source.slice) {
					var copied = new ArrayBuffer(source.byteLength);
					new Uint8Array(copied).set(new Uint8Array(source));
					return copied;
				}
				return source.slice(0);

			case '[object Boolean]':
			case '[object Number]':
			case '[object String]':
			case '[object Date]':
				return new source.constructor(source.valueOf());

			case '[object RegExp]':
				var re = new RegExp(source.source, source.toString().match(/[^\/]*$/)[0]);
				re.lastIndex = source.lastIndex;
				return re;

			case '[object Blob]':
				return new source.constructor([source], {type: source.type});
		}

		if (isFunction(source.cloneNode)) {
			return source.cloneNode(true);
		}
	}
}

function shallowCopy(src, dst) {
	if (isArray(src)) {
		dst = dst || [];

		for (var i = 0, ii = src.length; i < ii; i++) {
			dst[i] = src[i];
		}
	} else if (isObject(src)) {
		dst = dst || {};

		for (var key in src) {
			if (!(key.charAt(0) === '$' && key.charAt(1) === '$')) {
				dst[key] = src[key];
			}
		}
	}

	return dst || src;
}

function equals(o1, o2) {
	if (o1 === o2) return true;
	if (o1 === null || o2 === null) return false;
	if (o1 !== o1 && o2 !== o2) return true; // NaN === NaN
	var t1 = typeof o1, t2 = typeof o2, length, key, keySet;
	if (t1 == t2 && t1 == 'object') {
		if (isArray(o1)) {
			if (!isArray(o2)) return false;
			if ((length = o1.length) == o2.length) {
				for (key = 0; key < length; key++) {
					if (!equals(o1[key], o2[key])) return false;
				}
				return true;
			}
		} else if (isDate(o1)) {
			if (!isDate(o2)) return false;
			return equals(o1.getTime(), o2.getTime());
		} else if (isRegExp(o1)) {
			if (!isRegExp(o2)) return false;
			return o1.toString() == o2.toString();
		} else {
			if (isScope(o1) || isScope(o2) || isWindow(o1) || isWindow(o2) ||
				isArray(o2) || isDate(o2) || isRegExp(o2)) return false;
			keySet = createMap();
			for (key in o1) {
				if (key.charAt(0) === '$' || isFunction(o1[key])) continue;
				if (!equals(o1[key], o2[key])) return false;
				keySet[key] = true;
			}
			for (key in o2) {
				if (!(key in keySet) &&
						key.charAt(0) !== '$' &&
						isDefined(o2[key]) &&
						!isFunction(o2[key])) return false;
			}
			return true;
		}
	}
	return false;
}

var csp = function() {
	if (!isDefined(csp.rules)) {

		var ngCspElement = (window.document.querySelector('[ng-csp]') ||
										window.document.querySelector('[data-ng-csp]'));

		if (ngCspElement) {
			var ngCspAttribute = ngCspElement.getAttribute('ng-csp') ||
										ngCspElement.getAttribute('data-ng-csp');
			csp.rules = {
				noUnsafeEval: !ngCspAttribute || (ngCspAttribute.indexOf('no-unsafe-eval') !== -1),
				noInlineStyle: !ngCspAttribute || (ngCspAttribute.indexOf('no-inline-style') !== -1)
			};
		} else {
			csp.rules = {
				noUnsafeEval: noUnsafeEval(),
				noInlineStyle: false
			};
		}
	}

	return csp.rules;

	function noUnsafeEval() {
		try {

			new Function('');

			return false;
		} catch (e) {
			return true;
		}
	}
};

var jq = function() {
	if (isDefined(jq.name_)) return jq.name_;
	var el;
	var i, ii = ngAttrPrefixes.length, prefix, name;
	for (i = 0; i < ii; ++i) {
		prefix = ngAttrPrefixes[i];
		if (el = window.document.querySelector('[' + prefix.replace(':', '\\:') + 'jq]')) {
			name = el.getAttribute(prefix + 'jq');
			break;
		}
	}

	return (jq.name_ = name);
};

function concat(array1, array2, index) {
	return array1.concat(slice.call(array2, index));
}

function sliceArgs(args, startIndex) {
	return slice.call(args, startIndex || 0);
}

function bind(self, fn) {
	var curryArgs = arguments.length > 2 ? sliceArgs(arguments, 2) : [];
	if (isFunction(fn) && !(fn instanceof RegExp)) {
		return curryArgs.length
			? function() {
					return arguments.length
						? fn.apply(self, concat(curryArgs, arguments, 0))
						: fn.apply(self, curryArgs);
				}
			: function() {
					return arguments.length
						? fn.apply(self, arguments)
						: fn.call(self);
				};
	} else {
		// In IE, native methods are not functions so they cannot be bound (note: they don't need to be).
		return fn;
	}
}

function toJsonReplacer(key, value) {
	var val = value;

	if (typeof key === 'string' && key.charAt(0) === '$' && key.charAt(1) === '$') {
		val = undefined;
	} else if (isWindow(value)) {
		val = '$WINDOW';
	} else if (value &&  window.document === value) {
		val = '$DOCUMENT';
	} else if (isScope(value)) {
		val = '$SCOPE';
	}

	return val;
}

function toJson(obj, pretty) {
	if (isUndefined(obj)) return undefined;
	if (!isNumber(pretty)) {
		pretty = pretty ? 2 : null;
	}
	return JSON.stringify(obj, toJsonReplacer, pretty);
}

function fromJson(json) {
	return isString(json)
			? JSON.parse(json)
			: json;
}

var ALL_COLONS = /:/g;
function timezoneToOffset(timezone, fallback) {
	// IE/Edge do not "understand" colon (`:`) in timezone
	timezone = timezone.replace(ALL_COLONS, '');
	var requestedTimezoneOffset = Date.parse('Jan 01, 1970 00:00:00 ' + timezone) / 60000;
	return isNaN(requestedTimezoneOffset) ? fallback : requestedTimezoneOffset;
}

function addDateMinutes(date, minutes) {
	date = new Date(date.getTime());
	date.setMinutes(date.getMinutes() + minutes);
	return date;
}

function convertTimezoneToLocal(date, timezone, reverse) {
	reverse = reverse ? -1 : 1;
	var dateTimezoneOffset = date.getTimezoneOffset();
	var timezoneOffset = timezoneToOffset(timezone, dateTimezoneOffset);
	return addDateMinutes(date, reverse * (timezoneOffset - dateTimezoneOffset));
}

function startingTag(element) {
	element = jqLite(element).clone();
	try {
		// turns out IE does not let you set .html() on elements which
		// are not allowed to have children. So we just ignore it.
		element.empty();
	} catch (e) {}
	var elemHtml = jqLite('<div>').append(element).html();
	try {
		return element[0].nodeType === NODE_TYPE_TEXT ? lowercase(elemHtml) :
				elemHtml.
					match(/^(<[^>]+>)/)[1].
					replace(/^<([\w\-]+)/, function(match, nodeName) {return '<' + lowercase(nodeName);});
	} catch (e) {
		return lowercase(elemHtml);
	}

}

/////////////////////////////////////////////////

function tryDecodeURIComponent(value) {
	try {
		return decodeURIComponent(value);
	} catch (e) {
		// Ignore any invalid uri component.
	}
}

function parseKeyValue(keyValue) {
	var obj = {};
	forEach((keyValue || "").split('&'), function(keyValue) {
		var splitPoint, key, val;
		if (keyValue) {
			key = keyValue = keyValue.replace(/\+/g,'%20');
			splitPoint = keyValue.indexOf('=');
			if (splitPoint !== -1) {
				key = keyValue.substring(0, splitPoint);
				val = keyValue.substring(splitPoint + 1);
			}
			key = tryDecodeURIComponent(key);
			if (isDefined(key)) {
				val = isDefined(val) ? tryDecodeURIComponent(val) : true;
				if (!hasOwnProperty.call(obj, key)) {
					obj[key] = val;
				} else if (isArray(obj[key])) {
					obj[key].push(val);
				} else {
					obj[key] = [obj[key],val];
				}
			}
		}
	});
	return obj;
}

function toKeyValue(obj) {
	var parts = [];
	forEach(obj, function(value, key) {
		if (isArray(value)) {
			forEach(value, function(arrayValue) {
				parts.push(encodeUriQuery(key, true) +
									 (arrayValue === true ? '' : '=' + encodeUriQuery(arrayValue, true)));
			});
		} else {
		parts.push(encodeUriQuery(key, true) +
							 (value === true ? '' : '=' + encodeUriQuery(value, true)));
		}
	});
	return parts.length ? parts.join('&') : '';
}

function encodeUriSegment(val) {
	return encodeUriQuery(val, true).
						 replace(/%26/gi, '&').
						 replace(/%3D/gi, '=').
						 replace(/%2B/gi, '+');
}

function encodeUriQuery(val, pctEncodeSpaces) {
	return encodeURIComponent(val).
						 replace(/%40/gi, '@').
						 replace(/%3A/gi, ':').
						 replace(/%24/g, '$').
						 replace(/%2C/gi, ',').
						 replace(/%3B/gi, ';').
						 replace(/%20/g, (pctEncodeSpaces ? '%20' : '+'));
}

var ngAttrPrefixes = ['ng-', 'data-ng-', 'ng:', 'x-ng-'];

function getNgAttribute(element, ngAttr) {
	var attr, i, ii = ngAttrPrefixes.length;
	for (i = 0; i < ii; ++i) {
		attr = ngAttrPrefixes[i] + ngAttr;
		if (isString(attr = element.getAttribute(attr))) {
			return attr;
		}
	}
	return null;
}

function angularInit(element, bootstrap) {
	var appElement,
			module,
			config = {};

	// The element `element` has priority over any other element.
	forEach(ngAttrPrefixes, function(prefix) {
		var name = prefix + 'app';

		if (!appElement && element.hasAttribute && element.hasAttribute(name)) {
			appElement = element;
			module = element.getAttribute(name);
		}
	});
	forEach(ngAttrPrefixes, function(prefix) {
		var name = prefix + 'app';
		var candidate;

		if (!appElement && (candidate = element.querySelector('[' + name.replace(':', '\\:') + ']'))) {
			appElement = candidate;
			module = candidate.getAttribute(name);
		}
	});
	if (appElement) {
		config.strictDi = getNgAttribute(appElement, "strict-di") !== null;
		bootstrap(appElement, module ? [module] : [], config);
	}
}

function bootstrap(element, modules, config) {
	if (!isObject(config)) config = {};
	var defaultConfig = {
		strictDi: false
	};
	config = extend(defaultConfig, config);
	var doBootstrap = function() {
		element = jqLite(element);

		if (element.injector()) {
			var tag = (element[0] === window.document) ? 'document' : startingTag(element);
			// Encode angle brackets to prevent input from being sanitized to empty string #8683.
			throw ngMinErr(
					'btstrpd',
					"App already bootstrapped with this element '{0}'",
					tag.replace(/</,'&lt;').replace(/>/,'&gt;'));
		}

		modules = modules || [];
		modules.unshift(['$provide', function($provide) {
			$provide.value('$rootElement', element);
		}]);

		if (config.debugInfoEnabled) {
			// Pushing so that this overrides `debugInfoEnabled` setting defined in user's `modules`.
			modules.push(['$compileProvider', function($compileProvider) {
				$compileProvider.debugInfoEnabled(true);
			}]);
		}

		modules.unshift('ng');
		var injector = createInjector(modules, config.strictDi);
		injector.invoke(['$rootScope', '$rootElement', '$compile', '$injector',
			 function bootstrapApply(scope, element, compile, injector) {
				scope.$apply(function() {
					element.data('$injector', injector);
					compile(element)(scope);
				});
			}]
		);
		return injector;
	};

	var NG_ENABLE_DEBUG_INFO = /^NG_ENABLE_DEBUG_INFO!/;
	var NG_DEFER_BOOTSTRAP = /^NG_DEFER_BOOTSTRAP!/;

	if (window && NG_ENABLE_DEBUG_INFO.test(window.name)) {
		config.debugInfoEnabled = true;
		window.name = window.name.replace(NG_ENABLE_DEBUG_INFO, '');
	}

	if (window && !NG_DEFER_BOOTSTRAP.test(window.name)) {
		return doBootstrap();
	}

	window.name = window.name.replace(NG_DEFER_BOOTSTRAP, '');
	angular.resumeBootstrap = function(extraModules) {
		forEach(extraModules, function(module) {
			modules.push(module);
		});
		return doBootstrap();
	};

	if (isFunction(angular.resumeDeferredBootstrap)) {
		angular.resumeDeferredBootstrap();
	}
}

function reloadWithDebugInfo() {
	window.name = 'NG_ENABLE_DEBUG_INFO!' + window.name;
	window.location.reload();
}

function getTestability(rootElement) {
	var injector = angular.element(rootElement).injector();
	if (!injector) {
		throw ngMinErr('test',
			'no injector found for element argument to getTestability');
	}
	return injector.get('$$testability');
}

var SNAKE_CASE_REGEXP = /[A-Z]/g;
function snake_case(name, separator) {
	separator = separator || '_';
	return name.replace(SNAKE_CASE_REGEXP, function(letter, pos) {
		return (pos ? separator : '') + letter.toLowerCase();
	});
}

var bindJQueryFired = false;
function bindJQuery() {
	var originalCleanData;

	if (bindJQueryFired) {
		return;
	}

	// bind to jQuery if present;
	var jqName = jq();
	jQuery = isUndefined(jqName) ? window.jQuery :   // use jQuery (if present)
					 !jqName             ? undefined     :   // use jqLite
																 window[jqName];   // use jQuery specified by `ngJq`

	// Use jQuery if it exists with proper functionality, otherwise default to us.
	// Angular 1.2+ requires jQuery 1.7+ for on()/off() support.
	// Angular 1.3+ technically requires at least jQuery 2.1+ but it may work with older
	// versions. It will not work for sure with jQuery <1.7, though.
	if (jQuery && jQuery.fn.on) {
		jqLite = jQuery;
		extend(jQuery.fn, {
			scope: JQLitePrototype.scope,
			isolateScope: JQLitePrototype.isolateScope,
			controller: JQLitePrototype.controller,
			injector: JQLitePrototype.injector,
			inheritedData: JQLitePrototype.inheritedData
		});

		// All nodes removed from the DOM via various jQuery APIs like .remove()
		// are passed through jQuery.cleanData. Monkey-patch this method to fire
		// the $destroy event on all removed nodes.
		originalCleanData = jQuery.cleanData;
		jQuery.cleanData = function(elems) {
			var events;
			for (var i = 0, elem; (elem = elems[i]) != null; i++) {
				events = jQuery._data(elem, "events");
				if (events && events.$destroy) {
					jQuery(elem).triggerHandler('$destroy');
				}
			}
			originalCleanData(elems);
		};
	} else {
		jqLite = JQLite;
	}

	angular.element = jqLite;

	// Prevent double-proxying.
	bindJQueryFired = true;
}

function assertArg(arg, name, reason) {
	if (!arg) {
		throw ngMinErr('areq', "Argument '{0}' is {1}", (name || '?'), (reason || "required"));
	}
	return arg;
}

function assertArgFn(arg, name, acceptArrayAnnotation) {
	if (acceptArrayAnnotation && isArray(arg)) {
			arg = arg[arg.length - 1];
	}

	assertArg(isFunction(arg), name, 'not a function, got ' +
			(arg && typeof arg === 'object' ? arg.constructor.name || 'Object' : typeof arg));
	return arg;
}

function assertNotHasOwnProperty(name, context) {
	if (name === 'hasOwnProperty') {
		throw ngMinErr('badname', "hasOwnProperty is not a valid {0} name", context);
	}
}

//TODO(misko): this function needs to be removed
function getter(obj, path, bindFnToScope) {
	if (!path) return obj;
	var keys = path.split('.');
	var key;
	var lastInstance = obj;
	var len = keys.length;

	for (var i = 0; i < len; i++) {
		key = keys[i];
		if (obj) {
			obj = (lastInstance = obj)[key];
		}
	}
	if (!bindFnToScope && isFunction(obj)) {
		return bind(lastInstance, obj);
	}
	return obj;
}

function getBlockNodes(nodes) {
	// TODO(perf): update `nodes` instead of creating a new object?
	var node = nodes[0];
	var endNode = nodes[nodes.length - 1];
	var blockNodes;

	for (var i = 1; node !== endNode && (node = node.nextSibling); i++) {
		if (blockNodes || nodes[i] !== node) {
			if (!blockNodes) {
				blockNodes = jqLite(slice.call(nodes, 0, i));
			}
			blockNodes.push(node);
		}
	}

	return blockNodes || nodes;
}

function createMap() {
	return Object.create(null);
}

var NODE_TYPE_ELEMENT = 1;
var NODE_TYPE_ATTRIBUTE = 2;
var NODE_TYPE_TEXT = 3;
var NODE_TYPE_COMMENT = 8;
var NODE_TYPE_DOCUMENT = 9;
var NODE_TYPE_DOCUMENT_FRAGMENT = 11;
