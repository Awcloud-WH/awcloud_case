
var $$HashMapProvider = [function() {
	this.$get = [function() {
		return HashMap;
	}];
}];

var ARROW_ARG = /^([^\(]+?)=>/;
var FN_ARGS = /^[^\(]*\(\s*([^\)]*)\)/m;
var FN_ARG_SPLIT = /,/;
var FN_ARG = /^\s*(_?)(\S+?)\1\s*$/;
var STRIP_COMMENTS = /((\/\/.*$)|(\/\*[\s\S]*?\*\/))/mg;
var $injectorMinErr = minErr('$injector');

function stringifyFn(fn) {
	// Support: Chrome 50-51 only
	// Creating a new string by adding `' '` at the end, to hack around some bug in Chrome v50/51
	// (See https://github.com/angular/angular.js/issues/14487.)
	// TODO (gkalpak): Remove workaround when Chrome v52 is released
	return Function.prototype.toString.call(fn) + ' ';
}

function extractArgs(fn) {
	var fnText = stringifyFn(fn).replace(STRIP_COMMENTS, ''),
			args = fnText.match(ARROW_ARG) || fnText.match(FN_ARGS);
	return args;
}

function anonFn(fn) {
	// For anonymous functions, showing at the very least the function signature can help in
	// debugging.
	var args = extractArgs(fn);
	if (args) {
		return 'function(' + (args[1] || '').replace(/[\s\r\n]+/, ' ') + ')';
	}
	return 'fn';
}

function annotate(fn, strictDi, name) {
	var $inject,
			argDecl,
			last;

	if (typeof fn === 'function') {
		if (!($inject = fn.$inject)) {
			$inject = [];
			if (fn.length) {
				if (strictDi) {
					if (!isString(name) || !name) {
						name = fn.name || anonFn(fn);
					}
					throw $injectorMinErr('strictdi',
						'{0} is not using explicit annotation and cannot be invoked in strict mode', name);
				}
				argDecl = extractArgs(fn);
				forEach(argDecl[1].split(FN_ARG_SPLIT), function(arg) {
					arg.replace(FN_ARG, function(all, underscore, name) {
						$inject.push(name);
					});
				});
			}
			fn.$inject = $inject;
		}
	} else if (isArray(fn)) {
		last = fn.length - 1;
		assertArgFn(fn[last], 'fn');
		$inject = fn.slice(0, last);
	} else {
		assertArgFn(fn, 'fn', true);
	}
	return $inject;
}

///////////////////////////////////////

function createInjector(modulesToLoad, strictDi) {
	strictDi = (strictDi === true);
	var INSTANTIATING = {},
			providerSuffix = 'Provider',
			path = [],
			loadedModules = new HashMap([], true),
			providerCache = {
				$provide: {
						provider: supportObject(provider),
						factory: supportObject(factory),
						service: supportObject(service),
						value: supportObject(value),
						constant: supportObject(constant),
						decorator: decorator
					}
			};
			console.log(providerCache)
			var
			providerInjector = (providerCache.$injector =
					createInternalInjector(providerCache, function(serviceName, caller) {
						if (angular.isString(caller)) {
							path.push(caller);
						}
						throw $injectorMinErr('unpr', "Unknown provider: {0}", path.join(' <- '));
					})),
			instanceCache = {},
			protoInstanceInjector =
					createInternalInjector(instanceCache, function(serviceName, caller) {
						var provider = providerInjector.get(serviceName + providerSuffix, caller);
						return instanceInjector.invoke(
								provider.$get, provider, undefined, serviceName);
					}),
			instanceInjector = protoInstanceInjector;

	providerCache['$injector' + providerSuffix] = { $get: valueFn(protoInstanceInjector) };
	var runBlocks = loadModules(modulesToLoad);
	instanceInjector = protoInstanceInjector.get('$injector');
	instanceInjector.strictDi = strictDi;
	forEach(runBlocks, function(fn) { if (fn) instanceInjector.invoke(fn); });

	return instanceInjector;

	////////////////////////////////////
	// $provider
	////////////////////////////////////

	function supportObject(delegate) {
		return function(key, value) {
			if (isObject(key)) {
				forEach(key, reverseParams(delegate));
			} else {
				return delegate(key, value);
			}
		};
	}

	function provider(name, provider_) {
		assertNotHasOwnProperty(name, 'service');
		if (isFunction(provider_) || isArray(provider_)) {
			provider_ = providerInjector.instantiate(provider_);
		}
		if (!provider_.$get) {
			throw $injectorMinErr('pget', "Provider '{0}' must define $get factory method.", name);
		}
		return providerCache[name + providerSuffix] = provider_;
	}

	function enforceReturnValue(name, factory) {
		return function enforcedReturnValue() {
			var result = instanceInjector.invoke(factory, this);
			if (isUndefined(result)) {
				throw $injectorMinErr('undef', "Provider '{0}' must return a value from $get factory method.", name);
			}
			return result;
		};
	}

	function factory(name, factoryFn, enforce) {
		return provider(name, {
			$get: enforce !== false ? enforceReturnValue(name, factoryFn) : factoryFn
		});
	}

	function service(name, constructor) {
		return factory(name, ['$injector', function($injector) {
			return $injector.instantiate(constructor);
		}]);
	}

	function value(name, val) { return factory(name, valueFn(val), false); }

	function constant(name, value) {
		assertNotHasOwnProperty(name, 'constant');
		providerCache[name] = value;
		instanceCache[name] = value;
	}

	function decorator(serviceName, decorFn) {
		var origProvider = providerInjector.get(serviceName + providerSuffix),
				orig$get = origProvider.$get;

		origProvider.$get = function() {
			var origInstance = instanceInjector.invoke(orig$get, origProvider);
			return instanceInjector.invoke(decorFn, null, {$delegate: origInstance});
		};
	}

	////////////////////////////////////
	// Module Loading
	////////////////////////////////////
	function loadModules(modulesToLoad) {
		assertArg(isUndefined(modulesToLoad) || isArray(modulesToLoad), 'modulesToLoad', 'not an array');
		var runBlocks = [], moduleFn;
		forEach(modulesToLoad, function(module) {
			if (loadedModules.get(module)) return;
			loadedModules.put(module, true);

			function runInvokeQueue(queue) {
				var i, ii;
				for (i = 0, ii = queue.length; i < ii; i++) {
					var invokeArgs = queue[i],
							provider = providerInjector.get(invokeArgs[0]);

					provider[invokeArgs[1]].apply(provider, invokeArgs[2]);
				}
			}

			try {
				if (isString(module)) {
					moduleFn = angularModule(module);
					runBlocks = runBlocks.concat(loadModules(moduleFn.requires)).concat(moduleFn._runBlocks);
					runInvokeQueue(moduleFn._invokeQueue);
					runInvokeQueue(moduleFn._configBlocks);
				} else if (isFunction(module)) {
						runBlocks.push(providerInjector.invoke(module));
				} else if (isArray(module)) {
						runBlocks.push(providerInjector.invoke(module));
				} else {
					assertArgFn(module, 'module');
				}
			} catch (e) {
				if (isArray(module)) {
					module = module[module.length - 1];
				}
				if (e.message && e.stack && e.stack.indexOf(e.message) == -1) {
					// Safari & FF's stack traces don't contain error.message content
					// unlike those of Chrome and IE
					// So if stack doesn't contain message, we create a new string that contains both.
					// Since error.stack is read-only in Safari, I'm overriding e and not e.stack here.

					e = e.message + '\n' + e.stack;
				}
				throw $injectorMinErr('modulerr', "Failed to instantiate module {0} due to:\n{1}",
									module, e.stack || e.message || e);
			}
		});
		return runBlocks;
	}

	////////////////////////////////////
	// internal Injector
	////////////////////////////////////

	function createInternalInjector(cache, factory) {

		function getService(serviceName, caller) {
			if (cache.hasOwnProperty(serviceName)) {
				if (cache[serviceName] === INSTANTIATING) {
					throw $injectorMinErr('cdep', 'Circular dependency found: {0}',
										serviceName + ' <- ' + path.join(' <- '));
				}
				return cache[serviceName];
			} else {
				try {
					path.unshift(serviceName);
					cache[serviceName] = INSTANTIATING;
					return cache[serviceName] = factory(serviceName, caller);
				} catch (err) {
					if (cache[serviceName] === INSTANTIATING) {
						delete cache[serviceName];
					}
					throw err;
				} finally {
					path.shift();
				}
			}
		}

		function injectionArgs(fn, locals, serviceName) {
			var args = [],
					$inject = createInjector.$$annotate(fn, strictDi, serviceName);

			for (var i = 0, length = $inject.length; i < length; i++) {
				var key = $inject[i];
				if (typeof key !== 'string') {
					throw $injectorMinErr('itkn',
									'Incorrect injection token! Expected service name as string, got {0}', key);
				}
				args.push(locals && locals.hasOwnProperty(key) ? locals[key] :
																												 getService(key, serviceName));
			}
			return args;
		}

		function isClass(func) {
			// IE 9-11 do not support classes and IE9 leaks with the code below.
			if (msie <= 11) {
				return false;
			}
			// Workaround for MS Edge.
			// Check https://connect.microsoft.com/IE/Feedback/Details/2211653
			return typeof func === 'function'
				&& /^(?:class\s|constructor\()/.test(stringifyFn(func));
		}

		function invoke(fn, self, locals, serviceName) {
			if (typeof locals === 'string') {
				serviceName = locals;
				locals = null;
			}

			var args = injectionArgs(fn, locals, serviceName);
			if (isArray(fn)) {
				fn = fn[fn.length - 1];
			}

			if (!isClass(fn)) {
				// http://jsperf.com/angularjs-invoke-apply-vs-switch
				// #5388
				return fn.apply(self, args);
			} else {
				args.unshift(null);
				return new (Function.prototype.bind.apply(fn, args))();
			}
		}

		function instantiate(Type, locals, serviceName) {
			// Check if Type is annotated and use just the given function at n-1 as parameter
			// e.g. someModule.factory('greeter', ['$window', function(renamed$window) {}]);
			var ctor = (isArray(Type) ? Type[Type.length - 1] : Type);
			var args = injectionArgs(Type, locals, serviceName);
			// Empty object at position 0 is ignored for invocation with `new`, but required.
			args.unshift(null);
			return new (Function.prototype.bind.apply(ctor, args))();
		}

		return {
			invoke: invoke,
			instantiate: instantiate,
			get: getService,
			annotate: createInjector.$$annotate,
			has: function(name) {
				return providerCache.hasOwnProperty(name + providerSuffix) || cache.hasOwnProperty(name);
			}
		};
	}
}

createInjector.$$annotate = annotate;

function $AnchorScrollProvider() {

	var autoScrollingEnabled = true;

	this.disableAutoScrolling = function() {
		autoScrollingEnabled = false;
	};

	this.$get = ['$window', '$location', '$rootScope', function($window, $location, $rootScope) {
		var document = $window.document;

		// Helper function to get first anchor from a NodeList
		// (using `Array#some()` instead of `angular#forEach()` since it's more performant
		//  and working in all supported browsers.)
		function getFirstAnchor(list) {
			var result = null;
			Array.prototype.some.call(list, function(element) {
				if (nodeName_(element) === 'a') {
					result = element;
					return true;
				}
			});
			return result;
		}

		function getYOffset() {

			var offset = scroll.yOffset;

			if (isFunction(offset)) {
				offset = offset();
			} else if (isElement(offset)) {
				var elem = offset[0];
				var style = $window.getComputedStyle(elem);
				if (style.position !== 'fixed') {
					offset = 0;
				} else {
					offset = elem.getBoundingClientRect().bottom;
				}
			} else if (!isNumber(offset)) {
				offset = 0;
			}

			return offset;
		}

		function scrollTo(elem) {
			if (elem) {
				elem.scrollIntoView();

				var offset = getYOffset();

				if (offset) {
					// `offset` is the number of pixels we should scroll UP in order to align `elem` properly.
					// This is true ONLY if the call to `elem.scrollIntoView()` initially aligns `elem` at the
					// top of the viewport.
					//
					// IF the number of pixels from the top of `elem` to the end of the page's content is less
					// than the height of the viewport, then `elem.scrollIntoView()` will align the `elem` some
					// way down the page.
					//
					// This is often the case for elements near the bottom of the page.
					//
					// In such cases we do not need to scroll the whole `offset` up, just the difference between
					// the top of the element and the offset, which is enough to align the top of `elem` at the
					// desired position.
					var elemTop = elem.getBoundingClientRect().top;
					$window.scrollBy(0, elemTop - offset);
				}
			} else {
				$window.scrollTo(0, 0);
			}
		}

		function scroll(hash) {
			hash = isString(hash) ? hash : $location.hash();
			var elm;

			// empty hash, scroll to the top of the page
			if (!hash) scrollTo(null);

			// element with given id
			else if ((elm = document.getElementById(hash))) scrollTo(elm);

			// first anchor with given name :-D
			else if ((elm = getFirstAnchor(document.getElementsByName(hash)))) scrollTo(elm);

			// no element and hash == 'top', scroll to the top of the page
			else if (hash === 'top') scrollTo(null);
		}

		// does not scroll when user clicks on anchor link that is currently on
		// (no url change, no $location.hash() change), browser native does scroll
		if (autoScrollingEnabled) {
			$rootScope.$watch(function autoScrollWatch() {return $location.hash();},
				function autoScrollWatchAction(newVal, oldVal) {
					// skip the initial scroll if $location.hash is empty
					if (newVal === oldVal && newVal === '') return;

					jqLiteDocumentLoaded(function() {
						$rootScope.$evalAsync(scroll);
					});
				});
		}

		return scroll;
	}];
}

var $animateMinErr = minErr('$animate');
var ELEMENT_NODE = 1;
var NG_ANIMATE_CLASSNAME = 'ng-animate';

function mergeClasses(a,b) {
	if (!a && !b) return '';
	if (!a) return b;
	if (!b) return a;
	if (isArray(a)) a = a.join(' ');
	if (isArray(b)) b = b.join(' ');
	return a + ' ' + b;
}

function extractElementNode(element) {
	for (var i = 0; i < element.length; i++) {
		var elm = element[i];
		if (elm.nodeType === ELEMENT_NODE) {
			return elm;
		}
	}
}

function splitClasses(classes) {
	if (isString(classes)) {
		classes = classes.split(' ');
	}

	// Use createMap() to prevent class assumptions involving property names in
	// Object.prototype
	var obj = createMap();
	forEach(classes, function(klass) {
		// sometimes the split leaves empty string values
		// incase extra spaces were applied to the options
		if (klass.length) {
			obj[klass] = true;
		}
	});
	return obj;
}

// if any other type of options value besides an Object value is
// passed into the $animate.method() animation then this helper code
// will be run which will ignore it. While this patch is not the
// greatest solution to this, a lot of existing plugins depend on
// $animate to either call the callback (< 1.2) or return a promise
// that can be changed. This helper function ensures that the options
// are wiped clean incase a callback function is provided.
function prepareAnimateOptions(options) {
	return isObject(options)
			? options
			: {};
}

var $$CoreAnimateJsProvider = function() {
	this.$get = noop;
};

// this is prefixed with Core since it conflicts with
// the animateQueueProvider defined in ngAnimate/animateQueue.js
var $$CoreAnimateQueueProvider = function() {
	var postDigestQueue = new HashMap();
	var postDigestElements = [];

	this.$get = ['$$AnimateRunner', '$rootScope',
			 function($$AnimateRunner,   $rootScope) {
		return {
			enabled: noop,
			on: noop,
			off: noop,
			pin: noop,

			push: function(element, event, options, domOperation) {
				domOperation        && domOperation();

				options = options || {};
				options.from        && element.css(options.from);
				options.to          && element.css(options.to);

				if (options.addClass || options.removeClass) {
					addRemoveClassesPostDigest(element, options.addClass, options.removeClass);
				}

				var runner = new $$AnimateRunner(); // jshint ignore:line

				// since there are no animations to run the runner needs to be
				// notified that the animation call is complete.
				runner.complete();
				return runner;
			}
		};

		function updateData(data, classes, value) {
			var changed = false;
			if (classes) {
				classes = isString(classes) ? classes.split(' ') :
									isArray(classes) ? classes : [];
				forEach(classes, function(className) {
					if (className) {
						changed = true;
						data[className] = value;
					}
				});
			}
			return changed;
		}

		function handleCSSClassChanges() {
			forEach(postDigestElements, function(element) {
				var data = postDigestQueue.get(element);
				if (data) {
					var existing = splitClasses(element.attr('class'));
					var toAdd = '';
					var toRemove = '';
					forEach(data, function(status, className) {
						var hasClass = !!existing[className];
						if (status !== hasClass) {
							if (status) {
								toAdd += (toAdd.length ? ' ' : '') + className;
							} else {
								toRemove += (toRemove.length ? ' ' : '') + className;
							}
						}
					});

					forEach(element, function(elm) {
						toAdd    && jqLiteAddClass(elm, toAdd);
						toRemove && jqLiteRemoveClass(elm, toRemove);
					});
					postDigestQueue.remove(element);
				}
			});
			postDigestElements.length = 0;
		}

		function addRemoveClassesPostDigest(element, add, remove) {
			var data = postDigestQueue.get(element) || {};

			var classesAdded = updateData(data, add, true);
			var classesRemoved = updateData(data, remove, false);

			if (classesAdded || classesRemoved) {

				postDigestQueue.put(element, data);
				postDigestElements.push(element);

				if (postDigestElements.length === 1) {
					$rootScope.$$postDigest(handleCSSClassChanges);
				}
			}
		}
	}];
};

var $AnimateProvider = ['$provide', function($provide) {
	var provider = this;

	this.$$registeredAnimations = Object.create(null);

	this.register = function(name, factory) {
		if (name && name.charAt(0) !== '.') {
			throw $animateMinErr('notcsel', "Expecting class selector starting with '.' got '{0}'.", name);
		}

		var key = name + '-animation';
		provider.$$registeredAnimations[name.substr(1)] = key;
		$provide.factory(key, factory);
	};

	this.classNameFilter = function(expression) {
		if (arguments.length === 1) {
			this.$$classNameFilter = (expression instanceof RegExp) ? expression : null;
			if (this.$$classNameFilter) {
				var reservedRegex = new RegExp("(\\s+|\\/)" + NG_ANIMATE_CLASSNAME + "(\\s+|\\/)");
				if (reservedRegex.test(this.$$classNameFilter.toString())) {
					throw $animateMinErr('nongcls','$animateProvider.classNameFilter(regex) prohibits accepting a regex value which matches/contains the "{0}" CSS class.', NG_ANIMATE_CLASSNAME);

				}
			}
		}
		return this.$$classNameFilter;
	};

	this.$get = ['$$animateQueue', function($$animateQueue) {
		function domInsert(element, parentElement, afterElement) {
			// if for some reason the previous element was removed
			// from the dom sometime before this code runs then let's
			// just stick to using the parent element as the anchor
			if (afterElement) {
				var afterNode = extractElementNode(afterElement);
				if (afterNode && !afterNode.parentNode && !afterNode.previousElementSibling) {
					afterElement = null;
				}
			}
			afterElement ? afterElement.after(element) : parentElement.prepend(element);
		}

		return {
			// we don't call it directly since non-existant arguments may
			// be interpreted as null within the sub enabled function

			on: $$animateQueue.on,

			off: $$animateQueue.off,

			pin: $$animateQueue.pin,

			enabled: $$animateQueue.enabled,

			cancel: function(runner) {
				runner.end && runner.end();
			},

			enter: function(element, parent, after, options) {
				parent = parent && jqLite(parent);
				after = after && jqLite(after);
				parent = parent || after.parent();
				domInsert(element, parent, after);
				return $$animateQueue.push(element, 'enter', prepareAnimateOptions(options));
			},

			move: function(element, parent, after, options) {
				parent = parent && jqLite(parent);
				after = after && jqLite(after);
				parent = parent || after.parent();
				domInsert(element, parent, after);
				return $$animateQueue.push(element, 'move', prepareAnimateOptions(options));
			},

			leave: function(element, options) {
				return $$animateQueue.push(element, 'leave', prepareAnimateOptions(options), function() {
					element.remove();
				});
			},

			addClass: function(element, className, options) {
				options = prepareAnimateOptions(options);
				options.addClass = mergeClasses(options.addclass, className);
				return $$animateQueue.push(element, 'addClass', options);
			},

			removeClass: function(element, className, options) {
				options = prepareAnimateOptions(options);
				options.removeClass = mergeClasses(options.removeClass, className);
				return $$animateQueue.push(element, 'removeClass', options);
			},

			setClass: function(element, add, remove, options) {
				options = prepareAnimateOptions(options);
				options.addClass = mergeClasses(options.addClass, add);
				options.removeClass = mergeClasses(options.removeClass, remove);
				return $$animateQueue.push(element, 'setClass', options);
			},

			animate: function(element, from, to, className, options) {
				options = prepareAnimateOptions(options);
				options.from = options.from ? extend(options.from, from) : from;
				options.to   = options.to   ? extend(options.to, to)     : to;

				className = className || 'ng-inline-animate';
				options.tempClasses = mergeClasses(options.tempClasses, className);
				return $$animateQueue.push(element, 'animate', options);
			}
		};
	}];
}];

var $$AnimateAsyncRunFactoryProvider = function() {
	this.$get = ['$$rAF', function($$rAF) {
		var waitQueue = [];

		function waitForTick(fn) {
			waitQueue.push(fn);
			if (waitQueue.length > 1) return;
			$$rAF(function() {
				for (var i = 0; i < waitQueue.length; i++) {
					waitQueue[i]();
				}
				waitQueue = [];
			});
		}

		return function() {
			var passed = false;
			waitForTick(function() {
				passed = true;
			});
			return function(callback) {
				passed ? callback() : waitForTick(callback);
			};
		};
	}];
};

var $$AnimateRunnerFactoryProvider = function() {
	this.$get = ['$q', '$sniffer', '$$animateAsyncRun', '$document', '$timeout',
			 function($q,   $sniffer,   $$animateAsyncRun,   $document,   $timeout) {

		var INITIAL_STATE = 0;
		var DONE_PENDING_STATE = 1;
		var DONE_COMPLETE_STATE = 2;

		AnimateRunner.chain = function(chain, callback) {
			var index = 0;

			next();
			function next() {
				if (index === chain.length) {
					callback(true);
					return;
				}

				chain[index](function(response) {
					if (response === false) {
						callback(false);
						return;
					}
					index++;
					next();
				});
			}
		};

		AnimateRunner.all = function(runners, callback) {
			var count = 0;
			var status = true;
			forEach(runners, function(runner) {
				runner.done(onProgress);
			});

			function onProgress(response) {
				status = status && response;
				if (++count === runners.length) {
					callback(status);
				}
			}
		};

		function AnimateRunner(host) {
			this.setHost(host);

			var rafTick = $$animateAsyncRun();
			var timeoutTick = function(fn) {
				$timeout(fn, 0, false);
			};

			this._doneCallbacks = [];
			this._tick = function(fn) {
				var doc = $document[0];

				// the document may not be ready or attached
				// to the module for some internal tests
				if (doc && doc.hidden) {
					timeoutTick(fn);
				} else {
					rafTick(fn);
				}
			};
			this._state = 0;
		}

		AnimateRunner.prototype = {
			setHost: function(host) {
				this.host = host || {};
			},

			done: function(fn) {
				if (this._state === DONE_COMPLETE_STATE) {
					fn();
				} else {
					this._doneCallbacks.push(fn);
				}
			},

			progress: noop,

			getPromise: function() {
				if (!this.promise) {
					var self = this;
					this.promise = $q(function(resolve, reject) {
						self.done(function(status) {
							status === false ? reject() : resolve();
						});
					});
				}
				return this.promise;
			},

			then: function(resolveHandler, rejectHandler) {
				return this.getPromise().then(resolveHandler, rejectHandler);
			},

			'catch': function(handler) {
				return this.getPromise()['catch'](handler);
			},

			'finally': function(handler) {
				return this.getPromise()['finally'](handler);
			},

			pause: function() {
				if (this.host.pause) {
					this.host.pause();
				}
			},

			resume: function() {
				if (this.host.resume) {
					this.host.resume();
				}
			},

			end: function() {
				if (this.host.end) {
					this.host.end();
				}
				this._resolve(true);
			},

			cancel: function() {
				if (this.host.cancel) {
					this.host.cancel();
				}
				this._resolve(false);
			},

			complete: function(response) {
				var self = this;
				if (self._state === INITIAL_STATE) {
					self._state = DONE_PENDING_STATE;
					self._tick(function() {
						self._resolve(response);
					});
				}
			},

			_resolve: function(response) {
				if (this._state !== DONE_COMPLETE_STATE) {
					forEach(this._doneCallbacks, function(fn) {
						fn(response);
					});
					this._doneCallbacks.length = 0;
					this._state = DONE_COMPLETE_STATE;
				}
			}
		};

		return AnimateRunner;
	}];
};

var $CoreAnimateCssProvider = function() {
	this.$get = ['$$rAF', '$q', '$$AnimateRunner', function($$rAF, $q, $$AnimateRunner) {

		return function(element, initialOptions) {
			// all of the animation functions should create
			// a copy of the options data, however, if a
			// parent service has already created a copy then
			// we should stick to using that
			var options = initialOptions || {};
			if (!options.$$prepared) {
				options = copy(options);
			}

			// there is no point in applying the styles since
			// there is no animation that goes on at all in
			// this version of $animateCss.
			if (options.cleanupStyles) {
				options.from = options.to = null;
			}

			if (options.from) {
				element.css(options.from);
				options.from = null;
			}

			var closed, runner = new $$AnimateRunner();
			return {
				start: run,
				end: run
			};

			function run() {
				$$rAF(function() {
					applyAnimationContents();
					if (!closed) {
						runner.complete();
					}
					closed = true;
				});
				return runner;
			}

			function applyAnimationContents() {
				if (options.addClass) {
					element.addClass(options.addClass);
					options.addClass = null;
				}
				if (options.removeClass) {
					element.removeClass(options.removeClass);
					options.removeClass = null;
				}
				if (options.to) {
					element.css(options.to);
					options.to = null;
				}
			}
		};
	}];
};

function Browser(window, document, $log, $sniffer) {
	var self = this,
			location = window.location,
			history = window.history,
			setTimeout = window.setTimeout,
			clearTimeout = window.clearTimeout,
			pendingDeferIds = {};

	self.isMock = false;

	var outstandingRequestCount = 0;
	var outstandingRequestCallbacks = [];

	// TODO(vojta): remove this temporary api
	self.$$completeOutstandingRequest = completeOutstandingRequest;
	self.$$incOutstandingRequestCount = function() { outstandingRequestCount++; };

	function completeOutstandingRequest(fn) {
		try {
			fn.apply(null, sliceArgs(arguments, 1));
		} finally {
			outstandingRequestCount--;
			if (outstandingRequestCount === 0) {
				while (outstandingRequestCallbacks.length) {
					try {
						outstandingRequestCallbacks.pop()();
					} catch (e) {
						$log.error(e);
					}
				}
			}
		}
	}

	function getHash(url) {
		var index = url.indexOf('#');
		return index === -1 ? '' : url.substr(index);
	}

	self.notifyWhenNoOutstandingRequests = function(callback) {
		if (outstandingRequestCount === 0) {
			callback();
		} else {
			outstandingRequestCallbacks.push(callback);
		}
	};

	//////////////////////////////////////////////////////////////
	// URL API
	//////////////////////////////////////////////////////////////

	var cachedState, lastHistoryState,
			lastBrowserUrl = location.href,
			baseElement = document.find('base'),
			pendingLocation = null,
			getCurrentState = !$sniffer.history ? noop : function getCurrentState() {
				try {
					return history.state;
				} catch (e) {
					// MSIE can reportedly throw when there is no state (UNCONFIRMED).
				}
			};

	cacheState();
	lastHistoryState = cachedState;

	self.url = function(url, replace, state) {
		// In modern browsers `history.state` is `null` by default; treating it separately
		// from `undefined` would cause `$browser.url('/foo')` to change `history.state`
		// to undefined via `pushState`. Instead, let's change `undefined` to `null` here.
		if (isUndefined(state)) {
			state = null;
		}

		// Android Browser BFCache causes location, history reference to become stale.
		if (location !== window.location) location = window.location;
		if (history !== window.history) history = window.history;

		// setter
		if (url) {
			var sameState = lastHistoryState === state;

			// Don't change anything if previous and current URLs and states match. This also prevents
			// IE<10 from getting into redirect loop when in LocationHashbangInHtml5Url mode.
			// See https://github.com/angular/angular.js/commit/ffb2701
			if (lastBrowserUrl === url && (!$sniffer.history || sameState)) {
				return self;
			}
			var sameBase = lastBrowserUrl && stripHash(lastBrowserUrl) === stripHash(url);
			lastBrowserUrl = url;
			lastHistoryState = state;
			// Don't use history API if only the hash changed
			// due to a bug in IE10/IE11 which leads
			// to not firing a `hashchange` nor `popstate` event
			// in some cases (see #9143).
			if ($sniffer.history && (!sameBase || !sameState)) {
				history[replace ? 'replaceState' : 'pushState'](state, '', url);
				cacheState();
				// Do the assignment again so that those two variables are referentially identical.
				lastHistoryState = cachedState;
			} else {
				if (!sameBase) {
					pendingLocation = url;
				}
				if (replace) {
					location.replace(url);
				} else if (!sameBase) {
					location.href = url;
				} else {
					location.hash = getHash(url);
				}
				if (location.href !== url) {
					pendingLocation = url;
				}
			}
			if (pendingLocation) {
				pendingLocation = url;
			}
			return self;
		// getter
		} else {
			// - pendingLocation is needed as browsers don't allow to read out
			//   the new location.href if a reload happened or if there is a bug like in iOS 9 (see
			//   https://openradar.appspot.com/22186109).
			// - the replacement is a workaround for https://bugzilla.mozilla.org/show_bug.cgi?id=407172
			return pendingLocation || location.href.replace(/%27/g,"'");
		}
	};

	self.state = function() {
		return cachedState;
	};

	var urlChangeListeners = [],
			urlChangeInit = false;

	function cacheStateAndFireUrlChange() {
		pendingLocation = null;
		cacheState();
		fireUrlChange();
	}

	// This variable should be used *only* inside the cacheState function.
	var lastCachedState = null;
	function cacheState() {
		// This should be the only place in $browser where `history.state` is read.
		cachedState = getCurrentState();
		cachedState = isUndefined(cachedState) ? null : cachedState;

		// Prevent callbacks fo fire twice if both hashchange & popstate were fired.
		if (equals(cachedState, lastCachedState)) {
			cachedState = lastCachedState;
		}
		lastCachedState = cachedState;
	}

	function fireUrlChange() {
		if (lastBrowserUrl === self.url() && lastHistoryState === cachedState) {
			return;
		}

		lastBrowserUrl = self.url();
		lastHistoryState = cachedState;
		forEach(urlChangeListeners, function(listener) {
			listener(self.url(), cachedState);
		});
	}

	self.onUrlChange = function(callback) {
		// TODO(vojta): refactor to use node's syntax for events
		if (!urlChangeInit) {
			// We listen on both (hashchange/popstate) when available, as some browsers (e.g. Opera)
			// don't fire popstate when user change the address bar and don't fire hashchange when url
			// changed by push/replaceState

			// html5 history api - popstate event
			if ($sniffer.history) jqLite(window).on('popstate', cacheStateAndFireUrlChange);
			// hashchange event
			jqLite(window).on('hashchange', cacheStateAndFireUrlChange);

			urlChangeInit = true;
		}

		urlChangeListeners.push(callback);
		return callback;
	};

	self.$$applicationDestroyed = function() {
		jqLite(window).off('hashchange popstate', cacheStateAndFireUrlChange);
	};

	self.$$checkUrlChange = fireUrlChange;

	//////////////////////////////////////////////////////////////
	// Misc API
	//////////////////////////////////////////////////////////////

	self.baseHref = function() {
		var href = baseElement.attr('href');
		return href ? href.replace(/^(https?\:)?\/\/[^\/]*/, '') : '';
	};

	self.defer = function(fn, delay) {
		var timeoutId;
		outstandingRequestCount++;
		timeoutId = setTimeout(function() {
			delete pendingDeferIds[timeoutId];
			completeOutstandingRequest(fn);
		}, delay || 0);
		pendingDeferIds[timeoutId] = true;
		return timeoutId;
	};

	self.defer.cancel = function(deferId) {
		if (pendingDeferIds[deferId]) {
			delete pendingDeferIds[deferId];
			clearTimeout(deferId);
			completeOutstandingRequest(noop);
			return true;
		}
		return false;
	};

}

function $BrowserProvider() {
	this.$get = ['$window', '$log', '$sniffer', '$document',
			function($window, $log, $sniffer, $document) {
				return new Browser($window, $document, $log, $sniffer);
			}];
}

function $CacheFactoryProvider() {

	this.$get = function() {
		var caches = {};

		function cacheFactory(cacheId, options) {
			if (cacheId in caches) {
				throw minErr('$cacheFactory')('iid', "CacheId '{0}' is already taken!", cacheId);
			}

			var size = 0,
					stats = extend({}, options, {id: cacheId}),
					data = createMap(),
					capacity = (options && options.capacity) || Number.MAX_VALUE,
					lruHash = createMap(),
					freshEnd = null,
					staleEnd = null;

			return caches[cacheId] = {

				put: function(key, value) {
					if (isUndefined(value)) return;
					if (capacity < Number.MAX_VALUE) {
						var lruEntry = lruHash[key] || (lruHash[key] = {key: key});

						refresh(lruEntry);
					}

					if (!(key in data)) size++;
					data[key] = value;

					if (size > capacity) {
						this.remove(staleEnd.key);
					}

					return value;
				},

				get: function(key) {
					if (capacity < Number.MAX_VALUE) {
						var lruEntry = lruHash[key];

						if (!lruEntry) return;

						refresh(lruEntry);
					}

					return data[key];
				},

				remove: function(key) {
					if (capacity < Number.MAX_VALUE) {
						var lruEntry = lruHash[key];

						if (!lruEntry) return;

						if (lruEntry == freshEnd) freshEnd = lruEntry.p;
						if (lruEntry == staleEnd) staleEnd = lruEntry.n;
						link(lruEntry.n,lruEntry.p);

						delete lruHash[key];
					}

					if (!(key in data)) return;

					delete data[key];
					size--;
				},

				removeAll: function() {
					data = createMap();
					size = 0;
					lruHash = createMap();
					freshEnd = staleEnd = null;
				},

				destroy: function() {
					data = null;
					stats = null;
					lruHash = null;
					delete caches[cacheId];
				},

				info: function() {
					return extend({}, stats, {size: size});
				}
			};

			function refresh(entry) {
				if (entry != freshEnd) {
					if (!staleEnd) {
						staleEnd = entry;
					} else if (staleEnd == entry) {
						staleEnd = entry.n;
					}

					link(entry.n, entry.p);
					link(entry, freshEnd);
					freshEnd = entry;
					freshEnd.n = null;
				}
			}

			function link(nextEntry, prevEntry) {
				if (nextEntry != prevEntry) {
					if (nextEntry) nextEntry.p = prevEntry; //p stands for previous, 'prev' didn't minify
					if (prevEntry) prevEntry.n = nextEntry; //n stands for next, 'next' didn't minify
				}
			}
		}

		cacheFactory.info = function() {
			var info = {};
			forEach(caches, function(cache, cacheId) {
				info[cacheId] = cache.info();
			});
			return info;
		};

		cacheFactory.get = function(cacheId) {
			return caches[cacheId];
		};

		return cacheFactory;
	};
}

function $TemplateCacheProvider() {
	this.$get = ['$cacheFactory', function($cacheFactory) {
		return $cacheFactory('templates');
	}];
}

var $compileMinErr = minErr('$compile');

function UNINITIALIZED_VALUE() {}
var _UNINITIALIZED_VALUE = new UNINITIALIZED_VALUE();

$CompileProvider.$inject = ['$provide', '$$sanitizeUriProvider'];
function $CompileProvider($provide, $$sanitizeUriProvider) {
	var hasDirectives = {},
			Suffix = 'Directive',
			COMMENT_DIRECTIVE_REGEXP = /^\s*directive\:\s*([\w\-]+)\s+(.*)$/,
			CLASS_DIRECTIVE_REGEXP = /(([\w\-]+)(?:\:([^;]+))?;?)/,
			ALL_OR_NOTHING_ATTRS = makeMap('ngSrc,ngSrcset,src,srcset'),
			REQUIRE_PREFIX_REGEXP = /^(?:(\^\^?)?(\?)?(\^\^?)?)?/;

	// Ref: http://developers.whatwg.org/webappapis.html#event-handler-idl-attributes
	// The assumption is that future DOM event attribute names will begin with
	// 'on' and be composed of only English letters.
	var EVENT_HANDLER_ATTR_REGEXP = /^(on[a-z]+|formaction)$/;
	var bindingCache = createMap();

	function parseIsolateBindings(scope, directiveName, isController) {
		var LOCAL_REGEXP = /^\s*([@&<]|=(\*?))(\??)\s*(\w*)\s*$/;

		var bindings = createMap();

		forEach(scope, function(definition, scopeName) {
			if (definition in bindingCache) {
				bindings[scopeName] = bindingCache[definition];
				return;
			}
			var match = definition.match(LOCAL_REGEXP);

			if (!match) {
				throw $compileMinErr('iscp',
						"Invalid {3} for directive '{0}'." +
						" Definition: {... {1}: '{2}' ...}",
						directiveName, scopeName, definition,
						(isController ? "controller bindings definition" :
						"isolate scope definition"));
			}

			bindings[scopeName] = {
				mode: match[1][0],
				collection: match[2] === '*',
				optional: match[3] === '?',
				attrName: match[4] || scopeName
			};
			if (match[4]) {
				bindingCache[definition] = bindings[scopeName];
			}
		});

		return bindings;
	}

	function parseDirectiveBindings(directive, directiveName) {
		var bindings = {
			isolateScope: null,
			bindToController: null
		};
		if (isObject(directive.scope)) {
			if (directive.bindToController === true) {
				bindings.bindToController = parseIsolateBindings(directive.scope,
																												 directiveName, true);
				bindings.isolateScope = {};
			} else {
				bindings.isolateScope = parseIsolateBindings(directive.scope,
																										 directiveName, false);
			}
		}
		if (isObject(directive.bindToController)) {
			bindings.bindToController =
					parseIsolateBindings(directive.bindToController, directiveName, true);
		}
		if (isObject(bindings.bindToController)) {
			var controller = directive.controller;
			var controllerAs = directive.controllerAs;
			if (!controller) {
				// There is no controller, there may or may not be a controllerAs property
				throw $compileMinErr('noctrl',
							"Cannot bind to controller without directive '{0}'s controller.",
							directiveName);
			} else if (!identifierForController(controller, controllerAs)) {
				// There is a controller, but no identifier or controllerAs property
				throw $compileMinErr('noident',
							"Cannot bind to controller without identifier for directive '{0}'.",
							directiveName);
			}
		}
		return bindings;
	}

	function assertValidDirectiveName(name) {
		var letter = name.charAt(0);
		if (!letter || letter !== lowercase(letter)) {
			throw $compileMinErr('baddir', "Directive/Component name '{0}' is invalid. The first character must be a lowercase letter", name);
		}
		if (name !== name.trim()) {
			throw $compileMinErr('baddir',
						"Directive/Component name '{0}' is invalid. The name should not contain leading or trailing whitespaces",
						name);
		}
	}

	function getDirectiveRequire(directive) {
		var require = directive.require || (directive.controller && directive.name);

		if (!isArray(require) && isObject(require)) {
			forEach(require, function(value, key) {
				var match = value.match(REQUIRE_PREFIX_REGEXP);
				var name = value.substring(match[0].length);
				if (!name) require[key] = match[0] + key;
			});
		}

		return require;
	}

	this.directive = function registerDirective(name, directiveFactory) {
		assertNotHasOwnProperty(name, 'directive');
		if (isString(name)) {
			assertValidDirectiveName(name);
			assertArg(directiveFactory, 'directiveFactory');
			if (!hasDirectives.hasOwnProperty(name)) {
				hasDirectives[name] = [];
				$provide.factory(name + Suffix, ['$injector', '$exceptionHandler',
					function($injector, $exceptionHandler) {
						var directives = [];
						forEach(hasDirectives[name], function(directiveFactory, index) {
							try {
								var directive = $injector.invoke(directiveFactory);
								if (isFunction(directive)) {
									directive = { compile: valueFn(directive) };
								} else if (!directive.compile && directive.link) {
									directive.compile = valueFn(directive.link);
								}
								directive.priority = directive.priority || 0;
								directive.index = index;
								directive.name = directive.name || name;
								directive.require = getDirectiveRequire(directive);
								directive.restrict = directive.restrict || 'EA';
								directive.$$moduleName = directiveFactory.$$moduleName;
								directives.push(directive);
							} catch (e) {
								$exceptionHandler(e);
							}
						});
						return directives;
					}]);
			}
			hasDirectives[name].push(directiveFactory);
		} else {
			forEach(name, reverseParams(registerDirective));
		}
		return this;
	};

	this.component = function registerComponent(name, options) {
		var controller = options.controller || function() {};

		function factory($injector) {
			function makeInjectable(fn) {
				if (isFunction(fn) || isArray(fn)) {
					return function(tElement, tAttrs) {
						return $injector.invoke(fn, this, {$element: tElement, $attrs: tAttrs});
					};
				} else {
					return fn;
				}
			}

			var template = (!options.template && !options.templateUrl ? '' : options.template);
			var ddo = {
				controller: controller,
				controllerAs: identifierForController(options.controller) || options.controllerAs || '$ctrl',
				template: makeInjectable(template),
				templateUrl: makeInjectable(options.templateUrl),
				transclude: options.transclude,
				scope: {},
				bindToController: options.bindings || {},
				restrict: 'E',
				require: options.require
			};

			// Copy annotations (starting with $) over to the DDO
			forEach(options, function(val, key) {
				if (key.charAt(0) === '$') ddo[key] = val;
			});

			return ddo;
		}

		// TODO(pete) remove the following `forEach` before we release 1.6.0
		// The component-router@0.2.0 looks for the annotations on the controller constructor
		// Nothing in Angular looks for annotations on the factory function but we can't remove
		// it from 1.5.x yet.

		// Copy any annotation properties (starting with $) over to the factory and controller constructor functions
		// These could be used by libraries such as the new component router
		forEach(options, function(val, key) {
			if (key.charAt(0) === '$') {
				factory[key] = val;
				// Don't try to copy over annotations to named controller
				if (isFunction(controller)) controller[key] = val;
			}
		});

		factory.$inject = ['$injector'];

		return this.directive(name, factory);
	};

	this.aHrefSanitizationWhitelist = function(regexp) {
		if (isDefined(regexp)) {
			$$sanitizeUriProvider.aHrefSanitizationWhitelist(regexp);
			return this;
		} else {
			return $$sanitizeUriProvider.aHrefSanitizationWhitelist();
		}
	};

	this.imgSrcSanitizationWhitelist = function(regexp) {
		if (isDefined(regexp)) {
			$$sanitizeUriProvider.imgSrcSanitizationWhitelist(regexp);
			return this;
		} else {
			return $$sanitizeUriProvider.imgSrcSanitizationWhitelist();
		}
	};

	var debugInfoEnabled = true;
	this.debugInfoEnabled = function(enabled) {
		if (isDefined(enabled)) {
			debugInfoEnabled = enabled;
			return this;
		}
		return debugInfoEnabled;
	};

	var TTL = 10;

	this.onChangesTtl = function(value) {
		if (arguments.length) {
			TTL = value;
			return this;
		}
		return TTL;
	};

	this.$get = [
						'$injector', '$interpolate', '$exceptionHandler', '$templateRequest', '$parse',
						'$controller', '$rootScope', '$sce', '$animate', '$$sanitizeUri',
		function($injector,   $interpolate,   $exceptionHandler,   $templateRequest,   $parse,
						 $controller,   $rootScope,   $sce,   $animate,   $$sanitizeUri) {

		var SIMPLE_ATTR_NAME = /^\w/;
		var specialAttrHolder = window.document.createElement('div');

		var onChangesTtl = TTL;
		// The onChanges hooks should all be run together in a single digest
		// When changes occur, the call to trigger their hooks will be added to this queue
		var onChangesQueue;

		// This function is called in a $$postDigest to trigger all the onChanges hooks in a single digest
		function flushOnChangesQueue() {
			try {
				if (!(--onChangesTtl)) {
					// We have hit the TTL limit so reset everything
					onChangesQueue = undefined;
					throw $compileMinErr('infchng', '{0} $onChanges() iterations reached. Aborting!\n', TTL);
				}
				// We must run this hook in an apply since the $$postDigest runs outside apply
				$rootScope.$apply(function() {
					for (var i = 0, ii = onChangesQueue.length; i < ii; ++i) {
						onChangesQueue[i]();
					}
					// Reset the queue to trigger a new schedule next time there is a change
					onChangesQueue = undefined;
				});
			} finally {
				onChangesTtl++;
			}
		}

		function Attributes(element, attributesToCopy) {
			if (attributesToCopy) {
				var keys = Object.keys(attributesToCopy);
				var i, l, key;

				for (i = 0, l = keys.length; i < l; i++) {
					key = keys[i];
					this[key] = attributesToCopy[key];
				}
			} else {
				this.$attr = {};
			}

			this.$$element = element;
		}

		Attributes.prototype = {

			$normalize: directiveNormalize,

			$addClass: function(classVal) {
				if (classVal && classVal.length > 0) {
					$animate.addClass(this.$$element, classVal);
				}
			},

			$removeClass: function(classVal) {
				if (classVal && classVal.length > 0) {
					$animate.removeClass(this.$$element, classVal);
				}
			},

			$updateClass: function(newClasses, oldClasses) {
				var toAdd = tokenDifference(newClasses, oldClasses);
				if (toAdd && toAdd.length) {
					$animate.addClass(this.$$element, toAdd);
				}

				var toRemove = tokenDifference(oldClasses, newClasses);
				if (toRemove && toRemove.length) {
					$animate.removeClass(this.$$element, toRemove);
				}
			},

			$set: function(key, value, writeAttr, attrName) {
				// TODO: decide whether or not to throw an error if "class"
				//is set through this function since it may cause $updateClass to
				//become unstable.

				var node = this.$$element[0],
						booleanKey = getBooleanAttrName(node, key),
						aliasedKey = getAliasedAttrName(key),
						observer = key,
						nodeName;

				if (booleanKey) {
					this.$$element.prop(key, value);
					attrName = booleanKey;
				} else if (aliasedKey) {
					this[aliasedKey] = value;
					observer = aliasedKey;
				}

				this[key] = value;

				// translate normalized key to actual key
				if (attrName) {
					this.$attr[key] = attrName;
				} else {
					attrName = this.$attr[key];
					if (!attrName) {
						this.$attr[key] = attrName = snake_case(key, '-');
					}
				}

				nodeName = nodeName_(this.$$element);

				if ((nodeName === 'a' && (key === 'href' || key === 'xlinkHref')) ||
						(nodeName === 'img' && key === 'src')) {
					// sanitize a[href] and img[src] values
					this[key] = value = $$sanitizeUri(value, key === 'src');
				} else if (nodeName === 'img' && key === 'srcset' && isDefined(value)) {
					// sanitize img[srcset] values
					var result = "";

					// first check if there are spaces because it's not the same pattern
					var trimmedSrcset = trim(value);
					//                (   999x   ,|   999w   ,|   ,|,   )
					var srcPattern = /(\s+\d+x\s*,|\s+\d+w\s*,|\s+,|,\s+)/;
					var pattern = /\s/.test(trimmedSrcset) ? srcPattern : /(,)/;

					// split srcset into tuple of uri and descriptor except for the last item
					var rawUris = trimmedSrcset.split(pattern);

					// for each tuples
					var nbrUrisWith2parts = Math.floor(rawUris.length / 2);
					for (var i = 0; i < nbrUrisWith2parts; i++) {
						var innerIdx = i * 2;
						// sanitize the uri
						result += $$sanitizeUri(trim(rawUris[innerIdx]), true);
						// add the descriptor
						result += (" " + trim(rawUris[innerIdx + 1]));
					}

					// split the last item into uri and descriptor
					var lastTuple = trim(rawUris[i * 2]).split(/\s/);

					// sanitize the last uri
					result += $$sanitizeUri(trim(lastTuple[0]), true);

					// and add the last descriptor if any
					if (lastTuple.length === 2) {
						result += (" " + trim(lastTuple[1]));
					}
					this[key] = value = result;
				}

				if (writeAttr !== false) {
					if (value === null || isUndefined(value)) {
						this.$$element.removeAttr(attrName);
					} else {
						if (SIMPLE_ATTR_NAME.test(attrName)) {
							this.$$element.attr(attrName, value);
						} else {
							setSpecialAttr(this.$$element[0], attrName, value);
						}
					}
				}

				// fire observers
				var $$observers = this.$$observers;
				$$observers && forEach($$observers[observer], function(fn) {
					try {
						fn(value);
					} catch (e) {
						$exceptionHandler(e);
					}
				});
			},

			$observe: function(key, fn) {
				var attrs = this,
						$$observers = (attrs.$$observers || (attrs.$$observers = createMap())),
						listeners = ($$observers[key] || ($$observers[key] = []));

				listeners.push(fn);
				$rootScope.$evalAsync(function() {
					if (!listeners.$$inter && attrs.hasOwnProperty(key) && !isUndefined(attrs[key])) {
						// no one registered attribute interpolation function, so lets call it manually
						fn(attrs[key]);
					}
				});

				return function() {
					arrayRemove(listeners, fn);
				};
			}
		};

		function setSpecialAttr(element, attrName, value) {
			// Attributes names that do not start with letters (such as `(click)`) cannot be set using `setAttribute`
			// so we have to jump through some hoops to get such an attribute
			// https://github.com/angular/angular.js/pull/13318
			specialAttrHolder.innerHTML = "<span " + attrName + ">";
			var attributes = specialAttrHolder.firstChild.attributes;
			var attribute = attributes[0];
			// We have to remove the attribute from its container element before we can add it to the destination element
			attributes.removeNamedItem(attribute.name);
			attribute.value = value;
			element.attributes.setNamedItem(attribute);
		}

		function safeAddClass($element, className) {
			try {
				$element.addClass(className);
			} catch (e) {
				// ignore, since it means that we are trying to set class on
				// SVG element, where class name is read-only.
			}
		}

		var startSymbol = $interpolate.startSymbol(),
				endSymbol = $interpolate.endSymbol(),
				denormalizeTemplate = (startSymbol == '{{' && endSymbol  == '}}')
						? identity
						: function denormalizeTemplate(template) {
							return template.replace(/\{\{/g, startSymbol).replace(/}}/g, endSymbol);
				},
				NG_ATTR_BINDING = /^ngAttr[A-Z]/;
		var MULTI_ELEMENT_DIR_RE = /^(.+)Start$/;

		compile.$$addBindingInfo = debugInfoEnabled ? function $$addBindingInfo($element, binding) {
			var bindings = $element.data('$binding') || [];

			if (isArray(binding)) {
				bindings = bindings.concat(binding);
			} else {
				bindings.push(binding);
			}

			$element.data('$binding', bindings);
		} : noop;

		compile.$$addBindingClass = debugInfoEnabled ? function $$addBindingClass($element) {
			safeAddClass($element, 'ng-binding');
		} : noop;

		compile.$$addScopeInfo = debugInfoEnabled ? function $$addScopeInfo($element, scope, isolated, noTemplate) {
			var dataName = isolated ? (noTemplate ? '$isolateScopeNoTemplate' : '$isolateScope') : '$scope';
			$element.data(dataName, scope);
		} : noop;

		compile.$$addScopeClass = debugInfoEnabled ? function $$addScopeClass($element, isolated) {
			safeAddClass($element, isolated ? 'ng-isolate-scope' : 'ng-scope');
		} : noop;

		compile.$$createComment = function(directiveName, comment) {
			var content = '';
			if (debugInfoEnabled) {
				content = ' ' + (directiveName || '') + ': ';
				if (comment) content += comment + ' ';
			}
			return window.document.createComment(content);
		};

		return compile;

		//================================

		function compile($compileNodes, transcludeFn, maxPriority, ignoreDirective,
												previousCompileContext) {
			if (!($compileNodes instanceof jqLite)) {
				// jquery always rewraps, whereas we need to preserve the original selector so that we can
				// modify it.
				$compileNodes = jqLite($compileNodes);
			}

			var NOT_EMPTY = /\S+/;

			// We can not compile top level text elements since text nodes can be merged and we will
			// not be able to attach scope data to them, so we will wrap them in <span>
			for (var i = 0, len = $compileNodes.length; i < len; i++) {
				var domNode = $compileNodes[i];

				if (domNode.nodeType === NODE_TYPE_TEXT && domNode.nodeValue.match(NOT_EMPTY) ) {
					jqLiteWrapNode(domNode, $compileNodes[i] = window.document.createElement('span'));
				}
			}

			var compositeLinkFn =
							compileNodes($compileNodes, transcludeFn, $compileNodes,
													 maxPriority, ignoreDirective, previousCompileContext);
			compile.$$addScopeClass($compileNodes);
			var namespace = null;
			return function publicLinkFn(scope, cloneConnectFn, options) {
				assertArg(scope, 'scope');

				if (previousCompileContext && previousCompileContext.needsNewScope) {
					// A parent directive did a replace and a directive on this element asked
					// for transclusion, which caused us to lose a layer of element on which
					// we could hold the new transclusion scope, so we will create it manually
					// here.
					scope = scope.$parent.$new();
				}

				options = options || {};
				var parentBoundTranscludeFn = options.parentBoundTranscludeFn,
					transcludeControllers = options.transcludeControllers,
					futureParentElement = options.futureParentElement;

				// When `parentBoundTranscludeFn` is passed, it is a
				// `controllersBoundTransclude` function (it was previously passed
				// as `transclude` to directive.link) so we must unwrap it to get
				// its `boundTranscludeFn`
				if (parentBoundTranscludeFn && parentBoundTranscludeFn.$$boundTransclude) {
					parentBoundTranscludeFn = parentBoundTranscludeFn.$$boundTransclude;
				}

				if (!namespace) {
					namespace = detectNamespaceForChildElements(futureParentElement);
				}
				var $linkNode;
				if (namespace !== 'html') {
					// When using a directive with replace:true and templateUrl the $compileNodes
					// (or a child element inside of them)
					// might change, so we need to recreate the namespace adapted compileNodes
					// for call to the link function.
					// Note: This will already clone the nodes...
					$linkNode = jqLite(
						wrapTemplate(namespace, jqLite('<div>').append($compileNodes).html())
					);
				} else if (cloneConnectFn) {
					// important!!: we must call our jqLite.clone() since the jQuery one is trying to be smart
					// and sometimes changes the structure of the DOM.
					$linkNode = JQLitePrototype.clone.call($compileNodes);
				} else {
					$linkNode = $compileNodes;
				}

				if (transcludeControllers) {
					for (var controllerName in transcludeControllers) {
						$linkNode.data('$' + controllerName + 'Controller', transcludeControllers[controllerName].instance);
					}
				}

				compile.$$addScopeInfo($linkNode, scope);

				if (cloneConnectFn) cloneConnectFn($linkNode, scope);
				if (compositeLinkFn) compositeLinkFn(scope, $linkNode, $linkNode, parentBoundTranscludeFn);
				return $linkNode;
			};
		}

		function detectNamespaceForChildElements(parentElement) {
			// TODO: Make this detect MathML as well...
			var node = parentElement && parentElement[0];
			if (!node) {
				return 'html';
			} else {
				return nodeName_(node) !== 'foreignobject' && toString.call(node).match(/SVG/) ? 'svg' : 'html';
			}
		}

		function compileNodes(nodeList, transcludeFn, $rootElement, maxPriority, ignoreDirective,
														previousCompileContext) {
			var linkFns = [],
					attrs, directives, nodeLinkFn, childNodes, childLinkFn, linkFnFound, nodeLinkFnFound;

			for (var i = 0; i < nodeList.length; i++) {
				attrs = new Attributes();

				// we must always refer to nodeList[i] since the nodes can be replaced underneath us.
				directives = collectDirectives(nodeList[i], [], attrs, i === 0 ? maxPriority : undefined,
																				ignoreDirective);

				nodeLinkFn = (directives.length)
						? applyDirectivesToNode(directives, nodeList[i], attrs, transcludeFn, $rootElement,
																			null, [], [], previousCompileContext)
						: null;

				if (nodeLinkFn && nodeLinkFn.scope) {
					compile.$$addScopeClass(attrs.$$element);
				}

				childLinkFn = (nodeLinkFn && nodeLinkFn.terminal ||
											!(childNodes = nodeList[i].childNodes) ||
											!childNodes.length)
						? null
						: compileNodes(childNodes,
								 nodeLinkFn ? (
									(nodeLinkFn.transcludeOnThisElement || !nodeLinkFn.templateOnThisElement)
										 && nodeLinkFn.transclude) : transcludeFn);

				if (nodeLinkFn || childLinkFn) {
					linkFns.push(i, nodeLinkFn, childLinkFn);
					linkFnFound = true;
					nodeLinkFnFound = nodeLinkFnFound || nodeLinkFn;
				}

				//use the previous context only for the first element in the virtual group
				previousCompileContext = null;
			}

			// return a linking function if we have found anything, null otherwise
			return linkFnFound ? compositeLinkFn : null;

			function compositeLinkFn(scope, nodeList, $rootElement, parentBoundTranscludeFn) {
				var nodeLinkFn, childLinkFn, node, childScope, i, ii, idx, childBoundTranscludeFn;
				var stableNodeList;

				if (nodeLinkFnFound) {
					// copy nodeList so that if a nodeLinkFn removes or adds an element at this DOM level our
					// offsets don't get screwed up
					var nodeListLength = nodeList.length;
					stableNodeList = new Array(nodeListLength);

					// create a sparse array by only copying the elements which have a linkFn
					for (i = 0; i < linkFns.length; i+=3) {
						idx = linkFns[i];
						stableNodeList[idx] = nodeList[idx];
					}
				} else {
					stableNodeList = nodeList;
				}

				for (i = 0, ii = linkFns.length; i < ii;) {
					node = stableNodeList[linkFns[i++]];
					nodeLinkFn = linkFns[i++];
					childLinkFn = linkFns[i++];

					if (nodeLinkFn) {
						if (nodeLinkFn.scope) {
							childScope = scope.$new();
							compile.$$addScopeInfo(jqLite(node), childScope);
						} else {
							childScope = scope;
						}

						if (nodeLinkFn.transcludeOnThisElement) {
							childBoundTranscludeFn = createBoundTranscludeFn(
									scope, nodeLinkFn.transclude, parentBoundTranscludeFn);

						} else if (!nodeLinkFn.templateOnThisElement && parentBoundTranscludeFn) {
							childBoundTranscludeFn = parentBoundTranscludeFn;

						} else if (!parentBoundTranscludeFn && transcludeFn) {
							childBoundTranscludeFn = createBoundTranscludeFn(scope, transcludeFn);

						} else {
							childBoundTranscludeFn = null;
						}

						nodeLinkFn(childLinkFn, childScope, node, $rootElement, childBoundTranscludeFn);

					} else if (childLinkFn) {
						childLinkFn(scope, node.childNodes, undefined, parentBoundTranscludeFn);
					}
				}
			}
		}

		function createBoundTranscludeFn(scope, transcludeFn, previousBoundTranscludeFn) {
			function boundTranscludeFn(transcludedScope, cloneFn, controllers, futureParentElement, containingScope) {

				if (!transcludedScope) {
					transcludedScope = scope.$new(false, containingScope);
					transcludedScope.$$transcluded = true;
				}

				return transcludeFn(transcludedScope, cloneFn, {
					parentBoundTranscludeFn: previousBoundTranscludeFn,
					transcludeControllers: controllers,
					futureParentElement: futureParentElement
				});
			}

			// We need  to attach the transclusion slots onto the `boundTranscludeFn`
			// so that they are available inside the `controllersBoundTransclude` function
			var boundSlots = boundTranscludeFn.$$slots = createMap();
			for (var slotName in transcludeFn.$$slots) {
				if (transcludeFn.$$slots[slotName]) {
					boundSlots[slotName] = createBoundTranscludeFn(scope, transcludeFn.$$slots[slotName], previousBoundTranscludeFn);
				} else {
					boundSlots[slotName] = null;
				}
			}

			return boundTranscludeFn;
		}

		function collectDirectives(node, directives, attrs, maxPriority, ignoreDirective) {
			var nodeType = node.nodeType,
					attrsMap = attrs.$attr,
					match,
					className;

			switch (nodeType) {
				case NODE_TYPE_ELEMENT: 
					// use the node name: <directive>
					addDirective(directives,
							directiveNormalize(nodeName_(node)), 'E', maxPriority, ignoreDirective);

					// iterate over the attributes
					for (var attr, name, nName, ngAttrName, value, isNgAttr, nAttrs = node.attributes,
									 j = 0, jj = nAttrs && nAttrs.length; j < jj; j++) {
						var attrStartName = false;
						var attrEndName = false;

						attr = nAttrs[j];
						name = attr.name;
						value = trim(attr.value);

						// support ngAttr attribute binding
						ngAttrName = directiveNormalize(name);
						if (isNgAttr = NG_ATTR_BINDING.test(ngAttrName)) {
							name = name.replace(PREFIX_REGEXP, '')
								.substr(8).replace(/_(.)/g, function(match, letter) {
									return letter.toUpperCase();
								});
						}

						var multiElementMatch = ngAttrName.match(MULTI_ELEMENT_DIR_RE);
						if (multiElementMatch && directiveIsMultiElement(multiElementMatch[1])) {
							attrStartName = name;
							attrEndName = name.substr(0, name.length - 5) + 'end';
							name = name.substr(0, name.length - 6);
						}

						nName = directiveNormalize(name.toLowerCase());
						attrsMap[nName] = name;
						if (isNgAttr || !attrs.hasOwnProperty(nName)) {
								attrs[nName] = value;
								if (getBooleanAttrName(node, nName)) {
									attrs[nName] = true; // presence means true
								}
						}
						addAttrInterpolateDirective(node, directives, value, nName, isNgAttr);
						addDirective(directives, nName, 'A', maxPriority, ignoreDirective, attrStartName,
													attrEndName);
					}

					// use class as directive
					className = node.className;
					if (isObject(className)) {
							// Maybe SVGAnimatedString
							className = className.animVal;
					}
					if (isString(className) && className !== '') {
						while (match = CLASS_DIRECTIVE_REGEXP.exec(className)) {
							nName = directiveNormalize(match[2]);
							if (addDirective(directives, nName, 'C', maxPriority, ignoreDirective)) {
								attrs[nName] = trim(match[3]);
							}
							className = className.substr(match.index + match[0].length);
						}
					}
					break;
				case NODE_TYPE_TEXT: 
					if (msie === 11) {
						// Workaround for #11781
						while (node.parentNode && node.nextSibling && node.nextSibling.nodeType === NODE_TYPE_TEXT) {
							node.nodeValue = node.nodeValue + node.nextSibling.nodeValue;
							node.parentNode.removeChild(node.nextSibling);
						}
					}
					addTextInterpolateDirective(directives, node.nodeValue);
					break;
				case NODE_TYPE_COMMENT: 
					try {
						match = COMMENT_DIRECTIVE_REGEXP.exec(node.nodeValue);
						if (match) {
							nName = directiveNormalize(match[1]);
							if (addDirective(directives, nName, 'M', maxPriority, ignoreDirective)) {
								attrs[nName] = trim(match[2]);
							}
						}
					} catch (e) {
						// turns out that under some circumstances IE9 throws errors when one attempts to read
						// comment's node value.
						// Just ignore it and continue. (Can't seem to reproduce in test case.)
					}
					break;
			}

			directives.sort(byPriority);
			return directives;
		}

		function groupScan(node, attrStart, attrEnd) {
			var nodes = [];
			var depth = 0;
			if (attrStart && node.hasAttribute && node.hasAttribute(attrStart)) {
				do {
					if (!node) {
						throw $compileMinErr('uterdir',
											"Unterminated attribute, found '{0}' but no matching '{1}' found.",
											attrStart, attrEnd);
					}
					if (node.nodeType == NODE_TYPE_ELEMENT) {
						if (node.hasAttribute(attrStart)) depth++;
						if (node.hasAttribute(attrEnd)) depth--;
					}
					nodes.push(node);
					node = node.nextSibling;
				} while (depth > 0);
			} else {
				nodes.push(node);
			}

			return jqLite(nodes);
		}

		function groupElementsLinkFnWrapper(linkFn, attrStart, attrEnd) {
			return function groupedElementsLink(scope, element, attrs, controllers, transcludeFn) {
				element = groupScan(element[0], attrStart, attrEnd);
				return linkFn(scope, element, attrs, controllers, transcludeFn);
			};
		}

		function compilationGenerator(eager, $compileNodes, transcludeFn, maxPriority, ignoreDirective, previousCompileContext) {
			var compiled;

			if (eager) {
				return compile($compileNodes, transcludeFn, maxPriority, ignoreDirective, previousCompileContext);
			}
			return function lazyCompilation() {
				if (!compiled) {
					compiled = compile($compileNodes, transcludeFn, maxPriority, ignoreDirective, previousCompileContext);

					// Null out all of these references in order to make them eligible for garbage collection
					// since this is a potentially long lived closure
					$compileNodes = transcludeFn = previousCompileContext = null;
				}
				return compiled.apply(this, arguments);
			};
		}

		function applyDirectivesToNode(directives, compileNode, templateAttrs, transcludeFn,
																	 jqCollection, originalReplaceDirective, preLinkFns, postLinkFns,
																	 previousCompileContext) {
			previousCompileContext = previousCompileContext || {};

			var terminalPriority = -Number.MAX_VALUE,
					newScopeDirective = previousCompileContext.newScopeDirective,
					controllerDirectives = previousCompileContext.controllerDirectives,
					newIsolateScopeDirective = previousCompileContext.newIsolateScopeDirective,
					templateDirective = previousCompileContext.templateDirective,
					nonTlbTranscludeDirective = previousCompileContext.nonTlbTranscludeDirective,
					hasTranscludeDirective = false,
					hasTemplate = false,
					hasElementTranscludeDirective = previousCompileContext.hasElementTranscludeDirective,
					$compileNode = templateAttrs.$$element = jqLite(compileNode),
					directive,
					directiveName,
					$template,
					replaceDirective = originalReplaceDirective,
					childTranscludeFn = transcludeFn,
					linkFn,
					didScanForMultipleTransclusion = false,
					mightHaveMultipleTransclusionError = false,
					directiveValue;

			// executes all directives on the current element
			for (var i = 0, ii = directives.length; i < ii; i++) {
				directive = directives[i];
				var attrStart = directive.$$start;
				var attrEnd = directive.$$end;

				// collect multiblock sections
				if (attrStart) {
					$compileNode = groupScan(compileNode, attrStart, attrEnd);
				}
				$template = undefined;

				if (terminalPriority > directive.priority) {
					break; // prevent further processing of directives
				}

				if (directiveValue = directive.scope) {

					// skip the check for directives with async templates, we'll check the derived sync
					// directive when the template arrives
					if (!directive.templateUrl) {
						if (isObject(directiveValue)) {
							// This directive is trying to add an isolated scope.
							// Check that there is no scope of any kind already
							assertNoDuplicate('new/isolated scope', newIsolateScopeDirective || newScopeDirective,
																directive, $compileNode);
							newIsolateScopeDirective = directive;
						} else {
							// This directive is trying to add a child scope.
							// Check that there is no isolated scope already
							assertNoDuplicate('new/isolated scope', newIsolateScopeDirective, directive,
																$compileNode);
						}
					}

					newScopeDirective = newScopeDirective || directive;
				}

				directiveName = directive.name;

				// If we encounter a condition that can result in transclusion on the directive,
				// then scan ahead in the remaining directives for others that may cause a multiple
				// transclusion error to be thrown during the compilation process.  If a matching directive
				// is found, then we know that when we encounter a transcluded directive, we need to eagerly
				// compile the `transclude` function rather than doing it lazily in order to throw
				// exceptions at the correct time
				if (!didScanForMultipleTransclusion && ((directive.replace && (directive.templateUrl || directive.template))
						|| (directive.transclude && !directive.$$tlb))) {
								var candidateDirective;

								for (var scanningIndex = i + 1; candidateDirective = directives[scanningIndex++];) {
										if ((candidateDirective.transclude && !candidateDirective.$$tlb)
												|| (candidateDirective.replace && (candidateDirective.templateUrl || candidateDirective.template))) {
												mightHaveMultipleTransclusionError = true;
												break;
										}
								}

								didScanForMultipleTransclusion = true;
				}

				if (!directive.templateUrl && directive.controller) {
					directiveValue = directive.controller;
					controllerDirectives = controllerDirectives || createMap();
					assertNoDuplicate("'" + directiveName + "' controller",
							controllerDirectives[directiveName], directive, $compileNode);
					controllerDirectives[directiveName] = directive;
				}

				if (directiveValue = directive.transclude) {
					hasTranscludeDirective = true;

					// Special case ngIf and ngRepeat so that we don't complain about duplicate transclusion.
					// This option should only be used by directives that know how to safely handle element transclusion,
					// where the transcluded nodes are added or replaced after linking.
					if (!directive.$$tlb) {
						assertNoDuplicate('transclusion', nonTlbTranscludeDirective, directive, $compileNode);
						nonTlbTranscludeDirective = directive;
					}

					if (directiveValue == 'element') {
						hasElementTranscludeDirective = true;
						terminalPriority = directive.priority;
						$template = $compileNode;
						$compileNode = templateAttrs.$$element =
								jqLite(compile.$$createComment(directiveName, templateAttrs[directiveName]));
						compileNode = $compileNode[0];
						replaceWith(jqCollection, sliceArgs($template), compileNode);

						// Support: Chrome < 50
						// https://github.com/angular/angular.js/issues/14041

						// In the versions of V8 prior to Chrome 50, the document fragment that is created
						// in the `replaceWith` function is improperly garbage collected despite still
						// being referenced by the `parentNode` property of all of the child nodes.  By adding
						// a reference to the fragment via a different property, we can avoid that incorrect
						// behavior.
						// TODO: remove this line after Chrome 50 has been released
						$template[0].$$parentNode = $template[0].parentNode;

						childTranscludeFn = compilationGenerator(mightHaveMultipleTransclusionError, $template, transcludeFn, terminalPriority,
																				replaceDirective && replaceDirective.name, {
																					// Don't pass in:
																					// - controllerDirectives - otherwise we'll create duplicates controllers
																					// - newIsolateScopeDirective or templateDirective - combining templates with
																					//   element transclusion doesn't make sense.
																					//
																					// We need only nonTlbTranscludeDirective so that we prevent putting transclusion
																					// on the same element more than once.
																					nonTlbTranscludeDirective: nonTlbTranscludeDirective
																				});
					} else {

						var slots = createMap();

						$template = jqLite(jqLiteClone(compileNode)).contents();

						if (isObject(directiveValue)) {

							// We have transclusion slots,
							// collect them up, compile them and store their transclusion functions
							$template = [];

							var slotMap = createMap();
							var filledSlots = createMap();

							// Parse the element selectors
							forEach(directiveValue, function(elementSelector, slotName) {
								// If an element selector starts with a ? then it is optional
								var optional = (elementSelector.charAt(0) === '?');
								elementSelector = optional ? elementSelector.substring(1) : elementSelector;

								slotMap[elementSelector] = slotName;

								// We explicitly assign `null` since this implies that a slot was defined but not filled.
								// Later when calling boundTransclusion functions with a slot name we only error if the
								// slot is `undefined`
								slots[slotName] = null;

								// filledSlots contains `true` for all slots that are either optional or have been
								// filled. This is used to check that we have not missed any required slots
								filledSlots[slotName] = optional;
							});

							// Add the matching elements into their slot
							forEach($compileNode.contents(), function(node) {
								var slotName = slotMap[directiveNormalize(nodeName_(node))];
								if (slotName) {
									filledSlots[slotName] = true;
									slots[slotName] = slots[slotName] || [];
									slots[slotName].push(node);
								} else {
									$template.push(node);
								}
							});

							// Check for required slots that were not filled
							forEach(filledSlots, function(filled, slotName) {
								if (!filled) {
									throw $compileMinErr('reqslot', 'Required transclusion slot `{0}` was not filled.', slotName);
								}
							});

							for (var slotName in slots) {
								if (slots[slotName]) {
									// Only define a transclusion function if the slot was filled
									slots[slotName] = compilationGenerator(mightHaveMultipleTransclusionError, slots[slotName], transcludeFn);
								}
							}
						}

						$compileNode.empty(); // clear contents
						childTranscludeFn = compilationGenerator(mightHaveMultipleTransclusionError, $template, transcludeFn, undefined,
								undefined, { needsNewScope: directive.$$isolateScope || directive.$$newScope});
						childTranscludeFn.$$slots = slots;
					}
				}

				if (directive.template) {
					hasTemplate = true;
					assertNoDuplicate('template', templateDirective, directive, $compileNode);
					templateDirective = directive;

					directiveValue = (isFunction(directive.template))
							? directive.template($compileNode, templateAttrs)
							: directive.template;

					directiveValue = denormalizeTemplate(directiveValue);

					if (directive.replace) {
						replaceDirective = directive;
						if (jqLiteIsTextNode(directiveValue)) {
							$template = [];
						} else {
							$template = removeComments(wrapTemplate(directive.templateNamespace, trim(directiveValue)));
						}
						compileNode = $template[0];

						if ($template.length != 1 || compileNode.nodeType !== NODE_TYPE_ELEMENT) {
							throw $compileMinErr('tplrt',
									"Template for directive '{0}' must have exactly one root element. {1}",
									directiveName, '');
						}

						replaceWith(jqCollection, $compileNode, compileNode);

						var newTemplateAttrs = {$attr: {}};

						// combine directives from the original node and from the template:
						// - take the array of directives for this element
						// - split it into two parts, those that already applied (processed) and those that weren't (unprocessed)
						// - collect directives from the template and sort them by priority
						// - combine directives as: processed + template + unprocessed
						var templateDirectives = collectDirectives(compileNode, [], newTemplateAttrs);
						var unprocessedDirectives = directives.splice(i + 1, directives.length - (i + 1));

						if (newIsolateScopeDirective || newScopeDirective) {
							// The original directive caused the current element to be replaced but this element
							// also needs to have a new scope, so we need to tell the template directives
							// that they would need to get their scope from further up, if they require transclusion
							markDirectiveScope(templateDirectives, newIsolateScopeDirective, newScopeDirective);
						}
						directives = directives.concat(templateDirectives).concat(unprocessedDirectives);
						mergeTemplateAttributes(templateAttrs, newTemplateAttrs);

						ii = directives.length;
					} else {
						$compileNode.html(directiveValue);
					}
				}

				if (directive.templateUrl) {
					hasTemplate = true;
					assertNoDuplicate('template', templateDirective, directive, $compileNode);
					templateDirective = directive;

					if (directive.replace) {
						replaceDirective = directive;
					}

					nodeLinkFn = compileTemplateUrl(directives.splice(i, directives.length - i), $compileNode,

							templateAttrs, jqCollection, hasTranscludeDirective && childTranscludeFn, preLinkFns, postLinkFns, {
								controllerDirectives: controllerDirectives,
								newScopeDirective: (newScopeDirective !== directive) && newScopeDirective,
								newIsolateScopeDirective: newIsolateScopeDirective,
								templateDirective: templateDirective,
								nonTlbTranscludeDirective: nonTlbTranscludeDirective
							});
					ii = directives.length;
				} else if (directive.compile) {
					try {
						linkFn = directive.compile($compileNode, templateAttrs, childTranscludeFn);
						var context = directive.$$originalDirective || directive;
						if (isFunction(linkFn)) {
							addLinkFns(null, bind(context, linkFn), attrStart, attrEnd);
						} else if (linkFn) {
							addLinkFns(bind(context, linkFn.pre), bind(context, linkFn.post), attrStart, attrEnd);
						}
					} catch (e) {
						$exceptionHandler(e, startingTag($compileNode));
					}
				}

				if (directive.terminal) {
					nodeLinkFn.terminal = true;
					terminalPriority = Math.max(terminalPriority, directive.priority);
				}

			}

			nodeLinkFn.scope = newScopeDirective && newScopeDirective.scope === true;
			nodeLinkFn.transcludeOnThisElement = hasTranscludeDirective;
			nodeLinkFn.templateOnThisElement = hasTemplate;
			nodeLinkFn.transclude = childTranscludeFn;

			previousCompileContext.hasElementTranscludeDirective = hasElementTranscludeDirective;

			// might be normal or delayed nodeLinkFn depending on if templateUrl is present
			return nodeLinkFn;

			////////////////////

			function addLinkFns(pre, post, attrStart, attrEnd) {
				if (pre) {
					if (attrStart) pre = groupElementsLinkFnWrapper(pre, attrStart, attrEnd);
					pre.require = directive.require;
					pre.directiveName = directiveName;
					if (newIsolateScopeDirective === directive || directive.$$isolateScope) {
						pre = cloneAndAnnotateFn(pre, {isolateScope: true});
					}
					preLinkFns.push(pre);
				}
				if (post) {
					if (attrStart) post = groupElementsLinkFnWrapper(post, attrStart, attrEnd);
					post.require = directive.require;
					post.directiveName = directiveName;
					if (newIsolateScopeDirective === directive || directive.$$isolateScope) {
						post = cloneAndAnnotateFn(post, {isolateScope: true});
					}
					postLinkFns.push(post);
				}
			}

			function nodeLinkFn(childLinkFn, scope, linkNode, $rootElement, boundTranscludeFn) {
				var i, ii, linkFn, isolateScope, controllerScope, elementControllers, transcludeFn, $element,
						attrs, scopeBindingInfo;

				if (compileNode === linkNode) {
					attrs = templateAttrs;
					$element = templateAttrs.$$element;
				} else {
					$element = jqLite(linkNode);
					attrs = new Attributes($element, templateAttrs);
				}

				controllerScope = scope;
				if (newIsolateScopeDirective) {
					isolateScope = scope.$new(true);
				} else if (newScopeDirective) {
					controllerScope = scope.$parent;
				}

				if (boundTranscludeFn) {
					// track `boundTranscludeFn` so it can be unwrapped if `transcludeFn`
					// is later passed as `parentBoundTranscludeFn` to `publicLinkFn`
					transcludeFn = controllersBoundTransclude;
					transcludeFn.$$boundTransclude = boundTranscludeFn;
					// expose the slots on the `$transclude` function
					transcludeFn.isSlotFilled = function(slotName) {
						return !!boundTranscludeFn.$$slots[slotName];
					};
				}

				if (controllerDirectives) {
					elementControllers = setupControllers($element, attrs, transcludeFn, controllerDirectives, isolateScope, scope, newIsolateScopeDirective);
				}

				if (newIsolateScopeDirective) {
					// Initialize isolate scope bindings for new isolate scope directive.
					compile.$$addScopeInfo($element, isolateScope, true, !(templateDirective && (templateDirective === newIsolateScopeDirective ||
							templateDirective === newIsolateScopeDirective.$$originalDirective)));
					compile.$$addScopeClass($element, true);
					isolateScope.$$isolateBindings =
							newIsolateScopeDirective.$$isolateBindings;
					scopeBindingInfo = initializeDirectiveBindings(scope, attrs, isolateScope,
																				isolateScope.$$isolateBindings,
																				newIsolateScopeDirective);
					if (scopeBindingInfo.removeWatches) {
						isolateScope.$on('$destroy', scopeBindingInfo.removeWatches);
					}
				}

				// Initialize bindToController bindings
				for (var name in elementControllers) {
					var controllerDirective = controllerDirectives[name];
					var controller = elementControllers[name];
					var bindings = controllerDirective.$$bindings.bindToController;

					if (controller.identifier && bindings) {
						controller.bindingInfo =
							initializeDirectiveBindings(controllerScope, attrs, controller.instance, bindings, controllerDirective);
					} else {
						controller.bindingInfo = {};
					}

					var controllerResult = controller();
					if (controllerResult !== controller.instance) {
						// If the controller constructor has a return value, overwrite the instance
						// from setupControllers
						controller.instance = controllerResult;
						$element.data('$' + controllerDirective.name + 'Controller', controllerResult);
						controller.bindingInfo.removeWatches && controller.bindingInfo.removeWatches();
						controller.bindingInfo =
							initializeDirectiveBindings(controllerScope, attrs, controller.instance, bindings, controllerDirective);
					}
				}

				// Bind the required controllers to the controller, if `require` is an object and `bindToController` is truthy
				forEach(controllerDirectives, function(controllerDirective, name) {
					var require = controllerDirective.require;
					if (controllerDirective.bindToController && !isArray(require) && isObject(require)) {
						extend(elementControllers[name].instance, getControllers(name, require, $element, elementControllers));
					}
				});

				// Handle the init and destroy lifecycle hooks on all controllers that have them
				forEach(elementControllers, function(controller) {
					var controllerInstance = controller.instance;
					if (isFunction(controllerInstance.$onChanges)) {
						controllerInstance.$onChanges(controller.bindingInfo.initialChanges);
					}
					if (isFunction(controllerInstance.$onInit)) {
						controllerInstance.$onInit();
					}
					if (isFunction(controllerInstance.$onDestroy)) {
						controllerScope.$on('$destroy', function callOnDestroyHook() {
							controllerInstance.$onDestroy();
						});
					}
				});

				// PRELINKING
				for (i = 0, ii = preLinkFns.length; i < ii; i++) {
					linkFn = preLinkFns[i];
					invokeLinkFn(linkFn,
							linkFn.isolateScope ? isolateScope : scope,
							$element,
							attrs,
							linkFn.require && getControllers(linkFn.directiveName, linkFn.require, $element, elementControllers),
							transcludeFn
					);
				}

				// RECURSION
				// We only pass the isolate scope, if the isolate directive has a template,
				// otherwise the child elements do not belong to the isolate directive.
				var scopeToChild = scope;
				if (newIsolateScopeDirective && (newIsolateScopeDirective.template || newIsolateScopeDirective.templateUrl === null)) {
					scopeToChild = isolateScope;
				}
				childLinkFn && childLinkFn(scopeToChild, linkNode.childNodes, undefined, boundTranscludeFn);

				// POSTLINKING
				for (i = postLinkFns.length - 1; i >= 0; i--) {
					linkFn = postLinkFns[i];
					invokeLinkFn(linkFn,
							linkFn.isolateScope ? isolateScope : scope,
							$element,
							attrs,
							linkFn.require && getControllers(linkFn.directiveName, linkFn.require, $element, elementControllers),
							transcludeFn
					);
				}

				// Trigger $postLink lifecycle hooks
				forEach(elementControllers, function(controller) {
					var controllerInstance = controller.instance;
					if (isFunction(controllerInstance.$postLink)) {
						controllerInstance.$postLink();
					}
				});

				// This is the function that is injected as `$transclude`.
				// Note: all arguments are optional!
				function controllersBoundTransclude(scope, cloneAttachFn, futureParentElement, slotName) {
					var transcludeControllers;
					// No scope passed in:
					if (!isScope(scope)) {
						slotName = futureParentElement;
						futureParentElement = cloneAttachFn;
						cloneAttachFn = scope;
						scope = undefined;
					}

					if (hasElementTranscludeDirective) {
						transcludeControllers = elementControllers;
					}
					if (!futureParentElement) {
						futureParentElement = hasElementTranscludeDirective ? $element.parent() : $element;
					}
					if (slotName) {
						// slotTranscludeFn can be one of three things:
						//  * a transclude function - a filled slot
						//  * `null` - an optional slot that was not filled
						//  * `undefined` - a slot that was not declared (i.e. invalid)
						var slotTranscludeFn = boundTranscludeFn.$$slots[slotName];
						if (slotTranscludeFn) {
							return slotTranscludeFn(scope, cloneAttachFn, transcludeControllers, futureParentElement, scopeToChild);
						} else if (isUndefined(slotTranscludeFn)) {
							throw $compileMinErr('noslot',
							 'No parent directive that requires a transclusion with slot name "{0}". ' +
							 'Element: {1}',
							 slotName, startingTag($element));
						}
					} else {
						return boundTranscludeFn(scope, cloneAttachFn, transcludeControllers, futureParentElement, scopeToChild);
					}
				}
			}
		}

		function getControllers(directiveName, require, $element, elementControllers) {
			var value;

			if (isString(require)) {
				var match = require.match(REQUIRE_PREFIX_REGEXP);
				var name = require.substring(match[0].length);
				var inheritType = match[1] || match[3];
				var optional = match[2] === '?';

				//If only parents then start at the parent element
				if (inheritType === '^^') {
					$element = $element.parent();
				//Otherwise attempt getting the controller from elementControllers in case
				//the element is transcluded (and has no data) and to avoid .data if possible
				} else {
					value = elementControllers && elementControllers[name];
					value = value && value.instance;
				}

				if (!value) {
					var dataName = '$' + name + 'Controller';
					value = inheritType ? $element.inheritedData(dataName) : $element.data(dataName);
				}

				if (!value && !optional) {
					throw $compileMinErr('ctreq',
							"Controller '{0}', required by directive '{1}', can't be found!",
							name, directiveName);
				}
			} else if (isArray(require)) {
				value = [];
				for (var i = 0, ii = require.length; i < ii; i++) {
					value[i] = getControllers(directiveName, require[i], $element, elementControllers);
				}
			} else if (isObject(require)) {
				value = {};
				forEach(require, function(controller, property) {
					value[property] = getControllers(directiveName, controller, $element, elementControllers);
				});
			}

			return value || null;
		}

		function setupControllers($element, attrs, transcludeFn, controllerDirectives, isolateScope, scope, newIsolateScopeDirective) {
			var elementControllers = createMap();
			for (var controllerKey in controllerDirectives) {
				var directive = controllerDirectives[controllerKey];
				var locals = {
					$scope: directive === newIsolateScopeDirective || directive.$$isolateScope ? isolateScope : scope,
					$element: $element,
					$attrs: attrs,
					$transclude: transcludeFn
				};

				var controller = directive.controller;
				if (controller == '@') {
					controller = attrs[directive.name];
				}

				var controllerInstance = $controller(controller, locals, true, directive.controllerAs);

				// For directives with element transclusion the element is a comment.
				// In this case .data will not attach any data.
				// Instead, we save the controllers for the element in a local hash and attach to .data
				// later, once we have the actual element.
				elementControllers[directive.name] = controllerInstance;
				$element.data('$' + directive.name + 'Controller', controllerInstance.instance);
			}
			return elementControllers;
		}

		// Depending upon the context in which a directive finds itself it might need to have a new isolated
		// or child scope created. For instance:
		// * if the directive has been pulled into a template because another directive with a higher priority
		// asked for element transclusion
		// * if the directive itself asks for transclusion but it is at the root of a template and the original
		// element was replaced. See https://github.com/angular/angular.js/issues/12936
		function markDirectiveScope(directives, isolateScope, newScope) {
			for (var j = 0, jj = directives.length; j < jj; j++) {
				directives[j] = inherit(directives[j], {$$isolateScope: isolateScope, $$newScope: newScope});
			}
		}

		function addDirective(tDirectives, name, location, maxPriority, ignoreDirective, startAttrName,
													endAttrName) {
			if (name === ignoreDirective) return null;
			var match = null;
			if (hasDirectives.hasOwnProperty(name)) {
				for (var directive, directives = $injector.get(name + Suffix),
						i = 0, ii = directives.length; i < ii; i++) {
					try {
						directive = directives[i];
						if ((isUndefined(maxPriority) || maxPriority > directive.priority) &&
								 directive.restrict.indexOf(location) != -1) {
							if (startAttrName) {
								directive = inherit(directive, {$$start: startAttrName, $$end: endAttrName});
							}
							if (!directive.$$bindings) {
								var bindings = directive.$$bindings =
										parseDirectiveBindings(directive, directive.name);
								if (isObject(bindings.isolateScope)) {
									directive.$$isolateBindings = bindings.isolateScope;
								}
							}
							tDirectives.push(directive);
							match = directive;
						}
					} catch (e) { $exceptionHandler(e); }
				}
			}
			return match;
		}

		function directiveIsMultiElement(name) {
			if (hasDirectives.hasOwnProperty(name)) {
				for (var directive, directives = $injector.get(name + Suffix),
						i = 0, ii = directives.length; i < ii; i++) {
					directive = directives[i];
					if (directive.multiElement) {
						return true;
					}
				}
			}
			return false;
		}

		function mergeTemplateAttributes(dst, src) {
			var srcAttr = src.$attr,
					dstAttr = dst.$attr,
					$element = dst.$$element;

			// reapply the old attributes to the new element
			forEach(dst, function(value, key) {
				if (key.charAt(0) != '$') {
					if (src[key] && src[key] !== value) {
						value += (key === 'style' ? ';' : ' ') + src[key];
					}
					dst.$set(key, value, true, srcAttr[key]);
				}
			});

			// copy the new attributes on the old attrs object
			forEach(src, function(value, key) {
				if (key == 'class') {
					safeAddClass($element, value);
					dst['class'] = (dst['class'] ? dst['class'] + ' ' : '') + value;
				} else if (key == 'style') {
					$element.attr('style', $element.attr('style') + ';' + value);
					dst['style'] = (dst['style'] ? dst['style'] + ';' : '') + value;
					// `dst` will never contain hasOwnProperty as DOM parser won't let it.
					// You will get an "InvalidCharacterError: DOM Exception 5" error if you
					// have an attribute like "has-own-property" or "data-has-own-property", etc.
				} else if (key.charAt(0) != '$' && !dst.hasOwnProperty(key)) {
					dst[key] = value;
					dstAttr[key] = srcAttr[key];
				}
			});
		}

		function compileTemplateUrl(directives, $compileNode, tAttrs,
				$rootElement, childTranscludeFn, preLinkFns, postLinkFns, previousCompileContext) {
			var linkQueue = [],
					afterTemplateNodeLinkFn,
					afterTemplateChildLinkFn,
					beforeTemplateCompileNode = $compileNode[0],
					origAsyncDirective = directives.shift(),
					derivedSyncDirective = inherit(origAsyncDirective, {
						templateUrl: null, transclude: null, replace: null, $$originalDirective: origAsyncDirective
					}),
					templateUrl = (isFunction(origAsyncDirective.templateUrl))
							? origAsyncDirective.templateUrl($compileNode, tAttrs)
							: origAsyncDirective.templateUrl,
					templateNamespace = origAsyncDirective.templateNamespace;

			$compileNode.empty();

			$templateRequest(templateUrl)
				.then(function(content) {
					var compileNode, tempTemplateAttrs, $template, childBoundTranscludeFn;

					content = denormalizeTemplate(content);

					if (origAsyncDirective.replace) {
						if (jqLiteIsTextNode(content)) {
							$template = [];
						} else {
							$template = removeComments(wrapTemplate(templateNamespace, trim(content)));
						}
						compileNode = $template[0];

						if ($template.length != 1 || compileNode.nodeType !== NODE_TYPE_ELEMENT) {
							throw $compileMinErr('tplrt',
									"Template for directive '{0}' must have exactly one root element. {1}",
									origAsyncDirective.name, templateUrl);
						}

						tempTemplateAttrs = {$attr: {}};
						replaceWith($rootElement, $compileNode, compileNode);
						var templateDirectives = collectDirectives(compileNode, [], tempTemplateAttrs);

						if (isObject(origAsyncDirective.scope)) {
							// the original directive that caused the template to be loaded async required
							// an isolate scope
							markDirectiveScope(templateDirectives, true);
						}
						directives = templateDirectives.concat(directives);
						mergeTemplateAttributes(tAttrs, tempTemplateAttrs);
					} else {
						compileNode = beforeTemplateCompileNode;
						$compileNode.html(content);
					}

					directives.unshift(derivedSyncDirective);

					afterTemplateNodeLinkFn = applyDirectivesToNode(directives, compileNode, tAttrs,
							childTranscludeFn, $compileNode, origAsyncDirective, preLinkFns, postLinkFns,
							previousCompileContext);
					forEach($rootElement, function(node, i) {
						if (node == compileNode) {
							$rootElement[i] = $compileNode[0];
						}
					});
					afterTemplateChildLinkFn = compileNodes($compileNode[0].childNodes, childTranscludeFn);

					while (linkQueue.length) {
						var scope = linkQueue.shift(),
								beforeTemplateLinkNode = linkQueue.shift(),
								linkRootElement = linkQueue.shift(),
								boundTranscludeFn = linkQueue.shift(),
								linkNode = $compileNode[0];

						if (scope.$$destroyed) continue;

						if (beforeTemplateLinkNode !== beforeTemplateCompileNode) {
							var oldClasses = beforeTemplateLinkNode.className;

							if (!(previousCompileContext.hasElementTranscludeDirective &&
									origAsyncDirective.replace)) {
								// it was cloned therefore we have to clone as well.
								linkNode = jqLiteClone(compileNode);
							}
							replaceWith(linkRootElement, jqLite(beforeTemplateLinkNode), linkNode);

							// Copy in CSS classes from original node
							safeAddClass(jqLite(linkNode), oldClasses);
						}
						if (afterTemplateNodeLinkFn.transcludeOnThisElement) {
							childBoundTranscludeFn = createBoundTranscludeFn(scope, afterTemplateNodeLinkFn.transclude, boundTranscludeFn);
						} else {
							childBoundTranscludeFn = boundTranscludeFn;
						}
						afterTemplateNodeLinkFn(afterTemplateChildLinkFn, scope, linkNode, $rootElement,
							childBoundTranscludeFn);
					}
					linkQueue = null;
				});

			return function delayedNodeLinkFn(ignoreChildLinkFn, scope, node, rootElement, boundTranscludeFn) {
				var childBoundTranscludeFn = boundTranscludeFn;
				if (scope.$$destroyed) return;
				if (linkQueue) {
					linkQueue.push(scope,
												 node,
												 rootElement,
												 childBoundTranscludeFn);
				} else {
					if (afterTemplateNodeLinkFn.transcludeOnThisElement) {
						childBoundTranscludeFn = createBoundTranscludeFn(scope, afterTemplateNodeLinkFn.transclude, boundTranscludeFn);
					}
					afterTemplateNodeLinkFn(afterTemplateChildLinkFn, scope, node, rootElement, childBoundTranscludeFn);
				}
			};
		}

		function byPriority(a, b) {
			var diff = b.priority - a.priority;
			if (diff !== 0) return diff;
			if (a.name !== b.name) return (a.name < b.name) ? -1 : 1;
			return a.index - b.index;
		}

		function assertNoDuplicate(what, previousDirective, directive, element) {

			function wrapModuleNameIfDefined(moduleName) {
				return moduleName ?
					(' (module: ' + moduleName + ')') :
					'';
			}

			if (previousDirective) {
				throw $compileMinErr('multidir', 'Multiple directives [{0}{1}, {2}{3}] asking for {4} on: {5}',
						previousDirective.name, wrapModuleNameIfDefined(previousDirective.$$moduleName),
						directive.name, wrapModuleNameIfDefined(directive.$$moduleName), what, startingTag(element));
			}
		}

		function addTextInterpolateDirective(directives, text) {
			var interpolateFn = $interpolate(text, true);
			if (interpolateFn) {
				directives.push({
					priority: 0,
					compile: function textInterpolateCompileFn(templateNode) {
						var templateNodeParent = templateNode.parent(),
								hasCompileParent = !!templateNodeParent.length;

						// When transcluding a template that has bindings in the root
						// we don't have a parent and thus need to add the class during linking fn.
						if (hasCompileParent) compile.$$addBindingClass(templateNodeParent);

						return function textInterpolateLinkFn(scope, node) {
							var parent = node.parent();
							if (!hasCompileParent) compile.$$addBindingClass(parent);
							compile.$$addBindingInfo(parent, interpolateFn.expressions);
							scope.$watch(interpolateFn, function interpolateFnWatchAction(value) {
								node[0].nodeValue = value;
							});
						};
					}
				});
			}
		}

		function wrapTemplate(type, template) {
			type = lowercase(type || 'html');
			switch (type) {
			case 'svg':
			case 'math':
				var wrapper = window.document.createElement('div');
				wrapper.innerHTML = '<' + type + '>' + template + '</' + type + '>';
				return wrapper.childNodes[0].childNodes;
			default:
				return template;
			}
		}

		function getTrustedContext(node, attrNormalizedName) {
			if (attrNormalizedName == "srcdoc") {
				return $sce.HTML;
			}
			var tag = nodeName_(node);
			// maction[xlink:href] can source SVG.  It's not limited to <maction>.
			if (attrNormalizedName == "xlinkHref" ||
					(tag == "form" && attrNormalizedName == "action") ||
					(tag != "img" && (attrNormalizedName == "src" ||
														attrNormalizedName == "ngSrc"))) {
				return $sce.RESOURCE_URL;
			}
		}

		function addAttrInterpolateDirective(node, directives, value, name, allOrNothing) {
			var trustedContext = getTrustedContext(node, name);
			allOrNothing = ALL_OR_NOTHING_ATTRS[name] || allOrNothing;

			var interpolateFn = $interpolate(value, true, trustedContext, allOrNothing);

			// no interpolation found -> ignore
			if (!interpolateFn) return;

			if (name === "multiple" && nodeName_(node) === "select") {
				throw $compileMinErr("selmulti",
						"Binding to the 'multiple' attribute is not supported. Element: {0}",
						startingTag(node));
			}

			directives.push({
				priority: 100,
				compile: function() {
						return {
							pre: function attrInterpolatePreLinkFn(scope, element, attr) {
								var $$observers = (attr.$$observers || (attr.$$observers = createMap()));

								if (EVENT_HANDLER_ATTR_REGEXP.test(name)) {
									throw $compileMinErr('nodomevents',
											"Interpolations for HTML DOM event attributes are disallowed.  Please use the " +
													"ng- versions (such as ng-click instead of onclick) instead.");
								}

								// If the attribute has changed since last $interpolate()ed
								var newValue = attr[name];
								if (newValue !== value) {
									// we need to interpolate again since the attribute value has been updated
									// (e.g. by another directive's compile function)
									// ensure unset/empty values make interpolateFn falsy
									interpolateFn = newValue && $interpolate(newValue, true, trustedContext, allOrNothing);
									value = newValue;
								}

								// if attribute was updated so that there is no interpolation going on we don't want to
								// register any observers
								if (!interpolateFn) return;

								// initialize attr object so that it's ready in case we need the value for isolate
								// scope initialization, otherwise the value would not be available from isolate
								// directive's linking fn during linking phase
								attr[name] = interpolateFn(scope);

								($$observers[name] || ($$observers[name] = [])).$$inter = true;
								(attr.$$observers && attr.$$observers[name].$$scope || scope).
									$watch(interpolateFn, function interpolateFnWatchAction(newValue, oldValue) {
										//special case for class attribute addition + removal
										//so that class changes can tap into the animation
										//hooks provided by the $animate service. Be sure to
										//skip animations when the first digest occurs (when
										//both the new and the old values are the same) since
										//the CSS classes are the non-interpolated values
										if (name === 'class' && newValue != oldValue) {
											attr.$updateClass(newValue, oldValue);
										} else {
											attr.$set(name, newValue);
										}
									});
							}
						};
					}
			});
		}

		function replaceWith($rootElement, elementsToRemove, newNode) {
			var firstElementToRemove = elementsToRemove[0],
					removeCount = elementsToRemove.length,
					parent = firstElementToRemove.parentNode,
					i, ii;

			if ($rootElement) {
				for (i = 0, ii = $rootElement.length; i < ii; i++) {
					if ($rootElement[i] == firstElementToRemove) {
						$rootElement[i++] = newNode;
						for (var j = i, j2 = j + removeCount - 1,
										 jj = $rootElement.length;
								 j < jj; j++, j2++) {
							if (j2 < jj) {
								$rootElement[j] = $rootElement[j2];
							} else {
								delete $rootElement[j];
							}
						}
						$rootElement.length -= removeCount - 1;

						// If the replaced element is also the jQuery .context then replace it
						// .context is a deprecated jQuery api, so we should set it only when jQuery set it
						// http://api.jquery.com/context/
						if ($rootElement.context === firstElementToRemove) {
							$rootElement.context = newNode;
						}
						break;
					}
				}
			}

			if (parent) {
				parent.replaceChild(newNode, firstElementToRemove);
			}

			// Append all the `elementsToRemove` to a fragment. This will...
			// - remove them from the DOM
			// - allow them to still be traversed with .nextSibling
			// - allow a single fragment.qSA to fetch all elements being removed
			var fragment = window.document.createDocumentFragment();
			for (i = 0; i < removeCount; i++) {
				fragment.appendChild(elementsToRemove[i]);
			}

			if (jqLite.hasData(firstElementToRemove)) {
				// Copy over user data (that includes Angular's $scope etc.). Don't copy private
				// data here because there's no public interface in jQuery to do that and copying over
				// event listeners (which is the main use of private data) wouldn't work anyway.
				jqLite.data(newNode, jqLite.data(firstElementToRemove));

				// Remove $destroy event listeners from `firstElementToRemove`
				jqLite(firstElementToRemove).off('$destroy');
			}

			// Cleanup any data/listeners on the elements and children.
			// This includes invoking the $destroy event on any elements with listeners.
			jqLite.cleanData(fragment.querySelectorAll('*'));

			// Update the jqLite collection to only contain the `newNode`
			for (i = 1; i < removeCount; i++) {
				delete elementsToRemove[i];
			}
			elementsToRemove[0] = newNode;
			elementsToRemove.length = 1;
		}

		function cloneAndAnnotateFn(fn, annotation) {
			return extend(function() { return fn.apply(null, arguments); }, fn, annotation);
		}

		function invokeLinkFn(linkFn, scope, $element, attrs, controllers, transcludeFn) {
			try {
				linkFn(scope, $element, attrs, controllers, transcludeFn);
			} catch (e) {
				$exceptionHandler(e, startingTag($element));
			}
		}

		// Set up $watches for isolate scope and controller bindings. This process
		// only occurs for isolate scopes and new scopes with controllerAs.
		function initializeDirectiveBindings(scope, attrs, destination, bindings, directive) {
			var removeWatchCollection = [];
			var initialChanges = {};
			var changes;
			forEach(bindings, function initializeBinding(definition, scopeName) {
				var attrName = definition.attrName,
				optional = definition.optional,
				mode = definition.mode, // @, =, or &
				lastValue,
				parentGet, parentSet, compare, removeWatch;

				switch (mode) {

					case '@':
						if (!optional && !hasOwnProperty.call(attrs, attrName)) {
							destination[scopeName] = attrs[attrName] = void 0;
						}
						attrs.$observe(attrName, function(value) {
							if (isString(value) || isBoolean(value)) {
								var oldValue = destination[scopeName];
								recordChanges(scopeName, value, oldValue);
								destination[scopeName] = value;
							}
						});
						attrs.$$observers[attrName].$$scope = scope;
						lastValue = attrs[attrName];
						if (isString(lastValue)) {
							// If the attribute has been provided then we trigger an interpolation to ensure
							// the value is there for use in the link fn
							destination[scopeName] = $interpolate(lastValue)(scope);
						} else if (isBoolean(lastValue)) {
							// If the attributes is one of the BOOLEAN_ATTR then Angular will have converted
							// the value to boolean rather than a string, so we special case this situation
							destination[scopeName] = lastValue;
						}
						initialChanges[scopeName] = new SimpleChange(_UNINITIALIZED_VALUE, destination[scopeName]);
						break;

					case '=':
						if (!hasOwnProperty.call(attrs, attrName)) {
							if (optional) break;
							attrs[attrName] = void 0;
						}
						if (optional && !attrs[attrName]) break;

						parentGet = $parse(attrs[attrName]);
						if (parentGet.literal) {
							compare = equals;
						} else {
							compare = function simpleCompare(a, b) { return a === b || (a !== a && b !== b); };
						}
						parentSet = parentGet.assign || function() {
							// reset the change, or we will throw this exception on every $digest
							lastValue = destination[scopeName] = parentGet(scope);
							throw $compileMinErr('nonassign',
									"Expression '{0}' in attribute '{1}' used with directive '{2}' is non-assignable!",
									attrs[attrName], attrName, directive.name);
						};
						lastValue = destination[scopeName] = parentGet(scope);
						var parentValueWatch = function parentValueWatch(parentValue) {
							if (!compare(parentValue, destination[scopeName])) {
								// we are out of sync and need to copy
								if (!compare(parentValue, lastValue)) {
									// parent changed and it has precedence
									destination[scopeName] = parentValue;
								} else {
									// if the parent can be assigned then do so
									parentSet(scope, parentValue = destination[scopeName]);
								}
							}
							return lastValue = parentValue;
						};
						parentValueWatch.$stateful = true;
						if (definition.collection) {
							removeWatch = scope.$watchCollection(attrs[attrName], parentValueWatch);
						} else {
							removeWatch = scope.$watch($parse(attrs[attrName], parentValueWatch), null, parentGet.literal);
						}
						removeWatchCollection.push(removeWatch);
						break;

					case '<':
						if (!hasOwnProperty.call(attrs, attrName)) {
							if (optional) break;
							attrs[attrName] = void 0;
						}
						if (optional && !attrs[attrName]) break;

						parentGet = $parse(attrs[attrName]);

						var initialValue = destination[scopeName] = parentGet(scope);
						initialChanges[scopeName] = new SimpleChange(_UNINITIALIZED_VALUE, destination[scopeName]);

						removeWatch = scope.$watch(parentGet, function parentValueWatchAction(newValue, oldValue) {
							if (oldValue === newValue) {
								if (oldValue === initialValue) return;
								oldValue = initialValue;
							}
							recordChanges(scopeName, newValue, oldValue);
							destination[scopeName] = newValue;
						}, parentGet.literal);

						removeWatchCollection.push(removeWatch);
						break;

					case '&':
						// Don't assign Object.prototype method to scope
						parentGet = attrs.hasOwnProperty(attrName) ? $parse(attrs[attrName]) : noop;

						// Don't assign noop to destination if expression is not valid
						if (parentGet === noop && optional) break;

						destination[scopeName] = function(locals) {
							return parentGet(scope, locals);
						};
						break;
				}
			});

			function recordChanges(key, currentValue, previousValue) {
				if (isFunction(destination.$onChanges) && currentValue !== previousValue) {
					// If we have not already scheduled the top level onChangesQueue handler then do so now
					if (!onChangesQueue) {
						scope.$$postDigest(flushOnChangesQueue);
						onChangesQueue = [];
					}
					// If we have not already queued a trigger of onChanges for this controller then do so now
					if (!changes) {
						changes = {};
						onChangesQueue.push(triggerOnChangesHook);
					}
					// If the has been a change on this property already then we need to reuse the previous value
					if (changes[key]) {
						previousValue = changes[key].previousValue;
					}
					// Store this change
					changes[key] = new SimpleChange(previousValue, currentValue);
				}
			}

			function triggerOnChangesHook() {
				destination.$onChanges(changes);
				// Now clear the changes so that we schedule onChanges when more changes arrive
				changes = undefined;
			}

			return {
				initialChanges: initialChanges,
				removeWatches: removeWatchCollection.length && function removeWatches() {
					for (var i = 0, ii = removeWatchCollection.length; i < ii; ++i) {
						removeWatchCollection[i]();
					}
				}
			};
		}
	}];
}

function SimpleChange(previous, current) {
	this.previousValue = previous;
	this.currentValue = current;
}
SimpleChange.prototype.isFirstChange = function() { return this.previousValue === _UNINITIALIZED_VALUE; };

var PREFIX_REGEXP = /^((?:x|data)[\:\-_])/i;

function directiveNormalize(name) {
	return camelCase(name.replace(PREFIX_REGEXP, ''));
}

function nodesetLinkingFn(
	 scope,
	 nodeList,
	 rootElement,
	 boundTranscludeFn
) {}

function directiveLinkingFn(
	 nodesetLinkingFn,
	 scope,
	 node,
	 rootElement,
	 boundTranscludeFn
) {}

function tokenDifference(str1, str2) {
	var values = '',
			tokens1 = str1.split(/\s+/),
			tokens2 = str2.split(/\s+/);

	outer:
	for (var i = 0; i < tokens1.length; i++) {
		var token = tokens1[i];
		for (var j = 0; j < tokens2.length; j++) {
			if (token == tokens2[j]) continue outer;
		}
		values += (values.length > 0 ? ' ' : '') + token;
	}
	return values;
}

function removeComments(jqNodes) {
	jqNodes = jqLite(jqNodes);
	var i = jqNodes.length;

	if (i <= 1) {
		return jqNodes;
	}

	while (i--) {
		var node = jqNodes[i];
		if (node.nodeType === NODE_TYPE_COMMENT) {
			splice.call(jqNodes, i, 1);
		}
	}
	return jqNodes;
}

var $controllerMinErr = minErr('$controller');

var CNTRL_REG = /^(\S+)(\s+as\s+([\w$]+))?$/;
function identifierForController(controller, ident) {
	if (ident && isString(ident)) return ident;
	if (isString(controller)) {
		var match = CNTRL_REG.exec(controller);
		if (match) return match[3];
	}
}

function $ControllerProvider() {
	var controllers = {},
			globals = false;

	this.has = function(name) {
		return controllers.hasOwnProperty(name);
	};

	this.register = function(name, constructor) {
		assertNotHasOwnProperty(name, 'controller');
		if (isObject(name)) {
			extend(controllers, name);
		} else {
			controllers[name] = constructor;
		}
	};

	this.allowGlobals = function() {
		globals = true;
	};

	this.$get = ['$injector', '$window', function($injector, $window) {

		return function $controller(expression, locals, later, ident) {console.log(arguments)
			// PRIVATE API:
			//   param `later` --- indicates that the controller's constructor is invoked at a later time.
			//                     If true, $controller will allocate the object with the correct
			//                     prototype chain, but will not invoke the controller until a returned
			//                     callback is invoked.
			//   param `ident` --- An optional label which overrides the label parsed from the controller
			//                     expression, if any.
			var instance, match, constructor, identifier;
			later = later === true;
			if (ident && isString(ident)) {
				identifier = ident;
			}

			if (isString(expression)) {
				match = expression.match(CNTRL_REG);
				if (!match) {
					throw $controllerMinErr('ctrlfmt',
						"Badly formed controller string '{0}'. " +
						"Must match `__name__ as __id__` or `__name__`.", expression);
				}
				constructor = match[1],
				identifier = identifier || match[3];console.log(controllers, constructor);
				expression = controllers.hasOwnProperty(constructor)
						? controllers[constructor]
						: getter(locals.$scope, constructor, true) ||
								(globals ? getter($window, constructor, true) : undefined);

				assertArgFn(expression, constructor, true);
			}

			if (later) {
				// Instantiate controller later:
				// This machinery is used to create an instance of the object before calling the
				// controller's constructor itself.
				//
				// This allows properties to be added to the controller before the constructor is
				// invoked. Primarily, this is used for isolate scope bindings in $compile.
				//
				// This feature is not intended for use by applications, and is thus not documented
				// publicly.
				// Object creation: http://jsperf.com/create-constructor/2
				var controllerPrototype = (isArray(expression) ?
					expression[expression.length - 1] : expression).prototype;
				instance = Object.create(controllerPrototype || null);

				if (identifier) {
					addIdentifier(locals, identifier, instance, constructor || expression.name);
				}

				var instantiate;
				return instantiate = extend(function $controllerInit() {
					var result = $injector.invoke(expression, instance, locals, constructor);
					if (result !== instance && (isObject(result) || isFunction(result))) {
						instance = result;
						if (identifier) {
							// If result changed, re-assign controllerAs value to scope.
							addIdentifier(locals, identifier, instance, constructor || expression.name);
						}
					}
					return instance;
				}, {
					instance: instance,
					identifier: identifier
				});
			}

			instance = $injector.instantiate(expression, locals, constructor);

			if (identifier) {
				addIdentifier(locals, identifier, instance, constructor || expression.name);
			}

			return instance;
		};

		function addIdentifier(locals, identifier, instance, name) {
			if (!(locals && isObject(locals.$scope))) {
				throw minErr('$controller')('noscp',
					"Cannot export controller '{0}' as '{1}'! No $scope object provided via `locals`.",
					name, identifier);
			}

			locals.$scope[identifier] = instance;
		}
	}];
}

function $DocumentProvider() {
	this.$get = ['$window', function(window) {
		return jqLite(window.document);
	}];
}

function $ExceptionHandlerProvider() {
	this.$get = ['$log', function($log) {
		return function(exception, cause) {
			$log.error.apply($log, arguments);
		};
	}];
}

var $$ForceReflowProvider = function() {
	this.$get = ['$document', function($document) {
		return function(domNode) {
			//the line below will force the browser to perform a repaint so
			//that all the animated elements within the animation frame will
			//be properly updated and drawn on screen. This is required to
			//ensure that the preparation animation is properly flushed so that
			//the active state picks up from there. DO NOT REMOVE THIS LINE.
			//DO NOT OPTIMIZE THIS LINE. THE MINIFIER WILL REMOVE IT OTHERWISE WHICH
			//WILL RESULT IN AN UNPREDICTABLE BUG THAT IS VERY HARD TO TRACK DOWN AND
			//WILL TAKE YEARS AWAY FROM YOUR LIFE.
			if (domNode) {
				if (!domNode.nodeType && domNode instanceof jqLite) {
					domNode = domNode[0];
				}
			} else {
				domNode = $document[0].body;
			}
			return domNode.offsetWidth + 1;
		};
	}];
};

var APPLICATION_JSON = 'application/json';
var CONTENT_TYPE_APPLICATION_JSON = {'Content-Type': APPLICATION_JSON + ';charset=utf-8'};
var JSON_START = /^\[|^\{(?!\{)/;
var JSON_ENDS = {
	'[': /]$/,
	'{': /}$/
};
var JSON_PROTECTION_PREFIX = /^\)\]\}',?\n/;
var $httpMinErr = minErr('$http');
var $httpMinErrLegacyFn = function(method) {
	return function() {
		throw $httpMinErr('legacy', 'The method `{0}` on the promise returned from `$http` has been disabled.', method);
	};
};

function serializeValue(v) {
	if (isObject(v)) {
		return isDate(v) ? v.toISOString() : toJson(v);
	}
	return v;
}

function $HttpParamSerializerProvider() {

	this.$get = function() {
		return function ngParamSerializer(params) {
			if (!params) return '';
			var parts = [];
			forEachSorted(params, function(value, key) {
				if (value === null || isUndefined(value)) return;
				if (isArray(value)) {
					forEach(value, function(v) {
						parts.push(encodeUriQuery(key)  + '=' + encodeUriQuery(serializeValue(v)));
					});
				} else {
					parts.push(encodeUriQuery(key) + '=' + encodeUriQuery(serializeValue(value)));
				}
			});

			return parts.join('&');
		};
	};
}

function $HttpParamSerializerJQLikeProvider() {

	this.$get = function() {
		return function jQueryLikeParamSerializer(params) {
			if (!params) return '';
			var parts = [];
			serialize(params, '', true);
			return parts.join('&');

			function serialize(toSerialize, prefix, topLevel) {
				if (toSerialize === null || isUndefined(toSerialize)) return;
				if (isArray(toSerialize)) {
					forEach(toSerialize, function(value, index) {
						serialize(value, prefix + '[' + (isObject(value) ? index : '') + ']');
					});
				} else if (isObject(toSerialize) && !isDate(toSerialize)) {
					forEachSorted(toSerialize, function(value, key) {
						serialize(value, prefix +
								(topLevel ? '' : '[') +
								key +
								(topLevel ? '' : ']'));
					});
				} else {
					parts.push(encodeUriQuery(prefix) + '=' + encodeUriQuery(serializeValue(toSerialize)));
				}
			}
		};
	};
}

function defaultHttpResponseTransform(data, headers) {
	if (isString(data)) {
		// Strip json vulnerability protection prefix and trim whitespace
		var tempData = data.replace(JSON_PROTECTION_PREFIX, '').trim();

		if (tempData) {
			var contentType = headers('Content-Type');
			if ((contentType && (contentType.indexOf(APPLICATION_JSON) === 0)) || isJsonLike(tempData)) {
				data = fromJson(tempData);
			}
		}
	}

	return data;
}

function isJsonLike(str) {
		var jsonStart = str.match(JSON_START);
		return jsonStart && JSON_ENDS[jsonStart[0]].test(str);
}

function parseHeaders(headers) {
	var parsed = createMap(), i;

	function fillInParsed(key, val) {
		if (key) {
			parsed[key] = parsed[key] ? parsed[key] + ', ' + val : val;
		}
	}

	if (isString(headers)) {
		forEach(headers.split('\n'), function(line) {
			i = line.indexOf(':');
			fillInParsed(lowercase(trim(line.substr(0, i))), trim(line.substr(i + 1)));
		});
	} else if (isObject(headers)) {
		forEach(headers, function(headerVal, headerKey) {
			fillInParsed(lowercase(headerKey), trim(headerVal));
		});
	}

	return parsed;
}

function headersGetter(headers) {
	var headersObj;

	return function(name) {
		if (!headersObj) headersObj =  parseHeaders(headers);

		if (name) {
			var value = headersObj[lowercase(name)];
			if (value === void 0) {
				value = null;
			}
			return value;
		}

		return headersObj;
	};
}

function transformData(data, headers, status, fns) {
	if (isFunction(fns)) {
		return fns(data, headers, status);
	}

	forEach(fns, function(fn) {
		data = fn(data, headers, status);
	});

	return data;
}

function isSuccess(status) {
	return 200 <= status && status < 300;
}

function $HttpProvider() {

	var defaults = this.defaults = {
		// transform incoming response data
		transformResponse: [defaultHttpResponseTransform],

		// transform outgoing request data
		transformRequest: [function(d) {
			return isObject(d) && !isFile(d) && !isBlob(d) && !isFormData(d) ? toJson(d) : d;
		}],

		// default headers
		headers: {
			common: {
				'Accept': 'application/json, text/plain, */*'
			},
			post:   shallowCopy(CONTENT_TYPE_APPLICATION_JSON),
			put:    shallowCopy(CONTENT_TYPE_APPLICATION_JSON),
			patch:  shallowCopy(CONTENT_TYPE_APPLICATION_JSON)
		},

		xsrfCookieName: 'XSRF-TOKEN',
		xsrfHeaderName: 'X-XSRF-TOKEN',

		paramSerializer: '$httpParamSerializer'
	};

  var useApplyAsync = false;


	this.useApplyAsync = function(value) {
		if (isDefined(value)) {
			useApplyAsync = !!value;
			return this;
		}
		return useApplyAsync;
	};

	var useLegacyPromise = true;

	this.useLegacyPromiseExtensions = function(value) {
		if (isDefined(value)) {
			useLegacyPromise = !!value;
			return this;
		}
		return useLegacyPromise;
	};

	var interceptorFactories = this.interceptors = [];

	this.$get = ['$httpBackend', '$$cookieReader', '$cacheFactory', '$rootScope', '$q', '$injector',
			function($httpBackend, $$cookieReader, $cacheFactory, $rootScope, $q, $injector) {

		var defaultCache = $cacheFactory('$http');

		defaults.paramSerializer = isString(defaults.paramSerializer) ?
			$injector.get(defaults.paramSerializer) : defaults.paramSerializer;

		var reversedInterceptors = [];

		forEach(interceptorFactories, function(interceptorFactory) {
			reversedInterceptors.unshift(isString(interceptorFactory)
					? $injector.get(interceptorFactory) : $injector.invoke(interceptorFactory));
		});

		function $http(requestConfig) {

			if (!isObject(requestConfig)) {
				throw minErr('$http')('badreq', 'Http request configuration must be an object.  Received: {0}', requestConfig);
			}

			if (!isString(requestConfig.url)) {
				throw minErr('$http')('badreq', 'Http request configuration url must be a string.  Received: {0}', requestConfig.url);
			}

			var config = extend({
				method: 'get',
				transformRequest: defaults.transformRequest,
				transformResponse: defaults.transformResponse,
				paramSerializer: defaults.paramSerializer
			}, requestConfig);

			config.headers = mergeHeaders(requestConfig);
			config.method = uppercase(config.method);
			config.paramSerializer = isString(config.paramSerializer) ?
				$injector.get(config.paramSerializer) : config.paramSerializer;

			var serverRequest = function(config) {
				var headers = config.headers;
				var reqData = transformData(config.data, headersGetter(headers), undefined, config.transformRequest);

				// strip content-type if data is undefined
				if (isUndefined(reqData)) {
					forEach(headers, function(value, header) {
						if (lowercase(header) === 'content-type') {
								delete headers[header];
						}
					});
				}

				if (isUndefined(config.withCredentials) && !isUndefined(defaults.withCredentials)) {
					config.withCredentials = defaults.withCredentials;
				}

				// send request
				return sendReq(config, reqData).then(transformResponse, transformResponse);
			};

			var chain = [serverRequest, undefined];
			var promise = $q.when(config);

			// apply interceptors
			forEach(reversedInterceptors, function(interceptor) {
				if (interceptor.request || interceptor.requestError) {
					chain.unshift(interceptor.request, interceptor.requestError);
				}
				if (interceptor.response || interceptor.responseError) {
					chain.push(interceptor.response, interceptor.responseError);
				}
			});

			while (chain.length) {
				var thenFn = chain.shift();
				var rejectFn = chain.shift();

				promise = promise.then(thenFn, rejectFn);
			}

			if (useLegacyPromise) {
				promise.success = function(fn) {
					assertArgFn(fn, 'fn');

					promise.then(function(response) {
						fn(response.data, response.status, response.headers, config);
					});
					return promise;
				};

				promise.error = function(fn) {
					assertArgFn(fn, 'fn');

					promise.then(null, function(response) {
						fn(response.data, response.status, response.headers, config);
					});
					return promise;
				};
			} else {
				promise.success = $httpMinErrLegacyFn('success');
				promise.error = $httpMinErrLegacyFn('error');
			}

			return promise;

			function transformResponse(response) {
				// make a copy since the response must be cacheable
				var resp = extend({}, response);
				resp.data = transformData(response.data, response.headers, response.status,
																	config.transformResponse);
				return (isSuccess(response.status))
					? resp
					: $q.reject(resp);
			}

			function executeHeaderFns(headers, config) {
				var headerContent, processedHeaders = {};

				forEach(headers, function(headerFn, header) {
					if (isFunction(headerFn)) {
						headerContent = headerFn(config);
						if (headerContent != null) {
							processedHeaders[header] = headerContent;
						}
					} else {
						processedHeaders[header] = headerFn;
					}
				});

				return processedHeaders;
			}

			function mergeHeaders(config) {
				var defHeaders = defaults.headers,
						reqHeaders = extend({}, config.headers),
						defHeaderName, lowercaseDefHeaderName, reqHeaderName;

				defHeaders = extend({}, defHeaders.common, defHeaders[lowercase(config.method)]);

				// using for-in instead of forEach to avoid unnecessary iteration after header has been found
				defaultHeadersIteration:
				for (defHeaderName in defHeaders) {
					lowercaseDefHeaderName = lowercase(defHeaderName);

					for (reqHeaderName in reqHeaders) {
						if (lowercase(reqHeaderName) === lowercaseDefHeaderName) {
							continue defaultHeadersIteration;
						}
					}

					reqHeaders[defHeaderName] = defHeaders[defHeaderName];
				}

				// execute if header value is a function for merged headers
				return executeHeaderFns(reqHeaders, shallowCopy(config));
			}
		}

		$http.pendingRequests = [];

		createShortMethods('get', 'delete', 'head', 'jsonp');

		createShortMethodsWithData('post', 'put', 'patch');

		$http.defaults = defaults;

		return $http;

		function createShortMethods(names) {
			forEach(arguments, function(name) {
				$http[name] = function(url, config) {
					return $http(extend({}, config || {}, {
						method: name,
						url: url
					}));
				};
			});
		}

		function createShortMethodsWithData(name) {
			forEach(arguments, function(name) {
				$http[name] = function(url, data, config) {
					return $http(extend({}, config || {}, {
						method: name,
						url: url,
						data: data
					}));
				};
			});
		}

		function sendReq(config, reqData) {
			var deferred = $q.defer(),
					promise = deferred.promise,
					cache,
					cachedResp,
					reqHeaders = config.headers,
					url = buildUrl(config.url, config.paramSerializer(config.params));

			$http.pendingRequests.push(config);
			promise.then(removePendingReq, removePendingReq);

			if ((config.cache || defaults.cache) && config.cache !== false &&
					(config.method === 'GET' || config.method === 'JSONP')) {
				cache = isObject(config.cache) ? config.cache
							: isObject(defaults.cache) ? defaults.cache
							: defaultCache;
			}

			if (cache) {
				cachedResp = cache.get(url);
				if (isDefined(cachedResp)) {
					if (isPromiseLike(cachedResp)) {
						// cached request has already been sent, but there is no response yet
						cachedResp.then(resolvePromiseWithResult, resolvePromiseWithResult);
					} else {
						// serving from cache
						if (isArray(cachedResp)) {
							resolvePromise(cachedResp[1], cachedResp[0], shallowCopy(cachedResp[2]), cachedResp[3]);
						} else {
							resolvePromise(cachedResp, 200, {}, 'OK');
						}
					}
				} else {
					// put the promise for the non-transformed response into cache as a placeholder
					cache.put(url, promise);
				}
			}

			// if we won't have the response in cache, set the xsrf headers and
			// send the request to the backend
			if (isUndefined(cachedResp)) {
				var xsrfValue = urlIsSameOrigin(config.url)
						? $$cookieReader()[config.xsrfCookieName || defaults.xsrfCookieName]
						: undefined;
				if (xsrfValue) {
					reqHeaders[(config.xsrfHeaderName || defaults.xsrfHeaderName)] = xsrfValue;
				}

				$httpBackend(config.method, url, reqData, done, reqHeaders, config.timeout,
						config.withCredentials, config.responseType,
						createApplyHandlers(config.eventHandlers),
						createApplyHandlers(config.uploadEventHandlers));
			}

			return promise;

			function createApplyHandlers(eventHandlers) {
				if (eventHandlers) {
					var applyHandlers = {};
					forEach(eventHandlers, function(eventHandler, key) {
						applyHandlers[key] = function(event) {
							if (useApplyAsync) {
								$rootScope.$applyAsync(callEventHandler);
							} else if ($rootScope.$$phase) {
								callEventHandler();
							} else {
								$rootScope.$apply(callEventHandler);
							}

							function callEventHandler() {
								eventHandler(event);
							}
						};
					});
					return applyHandlers;
				}
			}

			function done(status, response, headersString, statusText) {
				if (cache) {
					if (isSuccess(status)) {
						cache.put(url, [status, response, parseHeaders(headersString), statusText]);
					} else {
						// remove promise from the cache
						cache.remove(url);
					}
				}

				function resolveHttpPromise() {
					resolvePromise(response, status, headersString, statusText);
				}

				if (useApplyAsync) {
					$rootScope.$applyAsync(resolveHttpPromise);
				} else {
					resolveHttpPromise();
					if (!$rootScope.$$phase) $rootScope.$apply();
				}
			}

			function resolvePromise(response, status, headers, statusText) {
				//status: HTTP response status code, 0, -1 (aborted by timeout / promise)
				status = status >= -1 ? status : 0;

				(isSuccess(status) ? deferred.resolve : deferred.reject)({
					data: response,
					status: status,
					headers: headersGetter(headers),
					config: config,
					statusText: statusText
				});
			}

			function resolvePromiseWithResult(result) {
				resolvePromise(result.data, result.status, shallowCopy(result.headers()), result.statusText);
			}

			function removePendingReq() {
				var idx = $http.pendingRequests.indexOf(config);
				if (idx !== -1) $http.pendingRequests.splice(idx, 1);
			}
		}

		function buildUrl(url, serializedParams) {
			if (serializedParams.length > 0) {
				url += ((url.indexOf('?') == -1) ? '?' : '&') + serializedParams;
			}
			return url;
		}
	}];
}

function $xhrFactoryProvider() {
	this.$get = function() {
		return function createXhr() {
			return new window.XMLHttpRequest();
		};
	};
}

function $HttpBackendProvider() {
	this.$get = ['$browser', '$window', '$document', '$xhrFactory', function($browser, $window, $document, $xhrFactory) {
		return createHttpBackend($browser, $xhrFactory, $browser.defer, $window.angular.callbacks, $document[0]);
	}];
}

function createHttpBackend($browser, createXhr, $browserDefer, callbacks, rawDocument) {
	// TODO(vojta): fix the signature
	return function(method, url, post, callback, headers, timeout, withCredentials, responseType, eventHandlers, uploadEventHandlers) {
		$browser.$$incOutstandingRequestCount();
		url = url || $browser.url();

		if (lowercase(method) == 'jsonp') {
			var callbackId = '_' + (callbacks.counter++).toString(36);
			callbacks[callbackId] = function(data) {
				callbacks[callbackId].data = data;
				callbacks[callbackId].called = true;
			};

			var jsonpDone = jsonpReq(url.replace('JSON_CALLBACK', 'angular.callbacks.' + callbackId),
					callbackId, function(status, text) {
				completeRequest(callback, status, callbacks[callbackId].data, "", text);
				callbacks[callbackId] = noop;
			});
		} else {

			var xhr = createXhr(method, url);

			xhr.open(method, url, true);
			forEach(headers, function(value, key) {
				if (isDefined(value)) {
						xhr.setRequestHeader(key, value);
				}
			});

			xhr.onload = function requestLoaded() {
				var statusText = xhr.statusText || '';

				// responseText is the old-school way of retrieving response (supported by IE9)
				// response/responseType properties were introduced in XHR Level2 spec (supported by IE10)
				var response = ('response' in xhr) ? xhr.response : xhr.responseText;

				// normalize IE9 bug (http://bugs.jquery.com/ticket/1450)
				var status = xhr.status === 1223 ? 204 : xhr.status;

				// fix status code when it is 0 (0 status is undocumented).
				// Occurs when accessing file resources or on Android 4.1 stock browser
				// while retrieving files from application cache.
				if (status === 0) {
					status = response ? 200 : urlResolve(url).protocol == 'file' ? 404 : 0;
				}

				completeRequest(callback,
						status,
						response,
						xhr.getAllResponseHeaders(),
						statusText);
			};

			var requestError = function() {
				// The response is always empty
				// See https://xhr.spec.whatwg.org/#request-error-steps and https://fetch.spec.whatwg.org/#concept-network-error
				completeRequest(callback, -1, null, null, '');
			};

			xhr.onerror = requestError;
			xhr.onabort = requestError;

			forEach(eventHandlers, function(value, key) {
					xhr.addEventListener(key, value);
			});

			forEach(uploadEventHandlers, function(value, key) {
				xhr.upload.addEventListener(key, value);
			});

			if (withCredentials) {
				xhr.withCredentials = true;
			}

			if (responseType) {
				try {
					xhr.responseType = responseType;
				} catch (e) {
					// WebKit added support for the json responseType value on 09/03/2013
					// https://bugs.webkit.org/show_bug.cgi?id=73648. Versions of Safari prior to 7 are
					// known to throw when setting the value "json" as the response type. Other older
					// browsers implementing the responseType
					//
					// The json response type can be ignored if not supported, because JSON payloads are
					// parsed on the client-side regardless.
					if (responseType !== 'json') {
						throw e;
					}
				}
			}

			xhr.send(isUndefined(post) ? null : post);
		}

		if (timeout > 0) {
			var timeoutId = $browserDefer(timeoutRequest, timeout);
		} else if (isPromiseLike(timeout)) {
			timeout.then(timeoutRequest);
		}

		function timeoutRequest() {
			jsonpDone && jsonpDone();
			xhr && xhr.abort();
		}

		function completeRequest(callback, status, response, headersString, statusText) {
			// cancel timeout and subsequent timeout promise resolution
			if (isDefined(timeoutId)) {
				$browserDefer.cancel(timeoutId);
			}
			jsonpDone = xhr = null;

			callback(status, response, headersString, statusText);
			$browser.$$completeOutstandingRequest(noop);
		}
	};

	function jsonpReq(url, callbackId, done) {
		// we can't use jQuery/jqLite here because jQuery does crazy stuff with script elements, e.g.:
		// - fetches local scripts via XHR and evals them
		// - adds and immediately removes script elements from the document
		var script = rawDocument.createElement('script'), callback = null;
		script.type = "text/javascript";
		script.src = url;
		script.async = true;

		callback = function(event) {
			removeEventListenerFn(script, "load", callback);
			removeEventListenerFn(script, "error", callback);
			rawDocument.body.removeChild(script);
			script = null;
			var status = -1;
			var text = "unknown";

			if (event) {
				if (event.type === "load" && !callbacks[callbackId].called) {
					event = { type: "error" };
				}
				text = event.type;
				status = event.type === "error" ? 404 : 200;
			}

			if (done) {
				done(status, text);
			}
		};

		addEventListenerFn(script, "load", callback);
		addEventListenerFn(script, "error", callback);
		rawDocument.body.appendChild(script);
		return callback;
	}
}

var $interpolateMinErr = angular.$interpolateMinErr = minErr('$interpolate');
$interpolateMinErr.throwNoconcat = function(text) {
	throw $interpolateMinErr('noconcat',
			"Error while interpolating: {0}\nStrict Contextual Escaping disallows " +
			"interpolations that concatenate multiple expressions when a trusted value is " +
			"required.  See http://docs.angularjs.org/api/ng.$sce", text);
};

$interpolateMinErr.interr = function(text, err) {
	return $interpolateMinErr('interr', "Can't interpolate: {0}\n{1}", text, err.toString());
};

function $InterpolateProvider() {
	var startSymbol = '{{';
	var endSymbol = '}}';

	this.startSymbol = function(value) {
		if (value) {
			startSymbol = value;
			return this;
		} else {
			return startSymbol;
		}
	};

	this.endSymbol = function(value) {
		if (value) {
			endSymbol = value;
			return this;
		} else {
			return endSymbol;
		}
	};

	this.$get = ['$parse', '$exceptionHandler', '$sce', function($parse, $exceptionHandler, $sce) {
		var startSymbolLength = startSymbol.length,
				endSymbolLength = endSymbol.length,
				escapedStartRegexp = new RegExp(startSymbol.replace(/./g, escape), 'g'),
				escapedEndRegexp = new RegExp(endSymbol.replace(/./g, escape), 'g');

		function escape(ch) {
			return '\\\\\\' + ch;
		}

		function unescapeText(text) {
			return text.replace(escapedStartRegexp, startSymbol).
				replace(escapedEndRegexp, endSymbol);
		}

		function stringify(value) {
			if (value == null) { // null || undefined
				return '';
			}
			switch (typeof value) {
				case 'string':
					break;
				case 'number':
					value = '' + value;
					break;
				default:
					value = toJson(value);
			}

			return value;
		}

		//TODO: this is the same as the constantWatchDelegate in parse.js
		function constantWatchDelegate(scope, listener, objectEquality, constantInterp) {
			var unwatch;
			return unwatch = scope.$watch(function constantInterpolateWatch(scope) {
				unwatch();
				return constantInterp(scope);
			}, listener, objectEquality);
		}

		function $interpolate(text, mustHaveExpression, trustedContext, allOrNothing) {
			// Provide a quick exit and simplified result function for text with no interpolation
			if (!text.length || text.indexOf(startSymbol) === -1) {
				var constantInterp;
				if (!mustHaveExpression) {
					var unescapedText = unescapeText(text);
					constantInterp = valueFn(unescapedText);
					constantInterp.exp = text;
					constantInterp.expressions = [];
					constantInterp.$$watchDelegate = constantWatchDelegate;
				}
				return constantInterp;
			}

			allOrNothing = !!allOrNothing;
			var startIndex,
					endIndex,
					index = 0,
					expressions = [],
					parseFns = [],
					textLength = text.length,
					exp,
					concat = [],
					expressionPositions = [];

			while (index < textLength) {
				if (((startIndex = text.indexOf(startSymbol, index)) != -1) &&
						 ((endIndex = text.indexOf(endSymbol, startIndex + startSymbolLength)) != -1)) {
					if (index !== startIndex) {
						concat.push(unescapeText(text.substring(index, startIndex)));
					}
					exp = text.substring(startIndex + startSymbolLength, endIndex);
					expressions.push(exp);
					parseFns.push($parse(exp, parseStringifyInterceptor));
					index = endIndex + endSymbolLength;
					expressionPositions.push(concat.length);
					concat.push('');
				} else {
					// we did not find an interpolation, so we have to add the remainder to the separators array
					if (index !== textLength) {
						concat.push(unescapeText(text.substring(index)));
					}
					break;
				}
			}

			// Concatenating expressions makes it hard to reason about whether some combination of
			// concatenated values are unsafe to use and could easily lead to XSS.  By requiring that a
			// single expression be used for iframe[src], object[src], etc., we ensure that the value
			// that's used is assigned or constructed by some JS code somewhere that is more testable or
			// make it obvious that you bound the value to some user controlled value.  This helps reduce
			// the load when auditing for XSS issues.
			if (trustedContext && concat.length > 1) {
					$interpolateMinErr.throwNoconcat(text);
			}

			if (!mustHaveExpression || expressions.length) {
				var compute = function(values) {
					for (var i = 0, ii = expressions.length; i < ii; i++) {
						if (allOrNothing && isUndefined(values[i])) return;
						concat[expressionPositions[i]] = values[i];
					}
					return concat.join('');
				};

				var getValue = function(value) {
					return trustedContext ?
						$sce.getTrusted(trustedContext, value) :
						$sce.valueOf(value);
				};

				return extend(function interpolationFn(context) {
						var i = 0;
						var ii = expressions.length;
						var values = new Array(ii);

						try {
							for (; i < ii; i++) {
								values[i] = parseFns[i](context);
							}

							return compute(values);
						} catch (err) {
							$exceptionHandler($interpolateMinErr.interr(text, err));
						}

					}, {
					// all of these properties are undocumented for now
					exp: text, //just for compatibility with regular watchers created via $watch
					expressions: expressions,
					$$watchDelegate: function(scope, listener) {
						var lastValue;
						return scope.$watchGroup(parseFns, function interpolateFnWatcher(values, oldValues) {
							var currValue = compute(values);
							if (isFunction(listener)) {
								listener.call(this, currValue, values !== oldValues ? lastValue : currValue, scope);
							}
							lastValue = currValue;
						});
					}
				});
			}

			function parseStringifyInterceptor(value) {
				try {
					value = getValue(value);
					return allOrNothing && !isDefined(value) ? value : stringify(value);
				} catch (err) {
					$exceptionHandler($interpolateMinErr.interr(text, err));
				}
			}
		}

		$interpolate.startSymbol = function() {
			return startSymbol;
		};

		$interpolate.endSymbol = function() {
			return endSymbol;
		};

		return $interpolate;
	}];
}

function $IntervalProvider() {
	this.$get = ['$rootScope', '$window', '$q', '$$q', '$browser',
			 function($rootScope,   $window,   $q,   $$q,   $browser) {
		var intervals = {};

		function interval(fn, delay, count, invokeApply) {
			var hasParams = arguments.length > 4,
					args = hasParams ? sliceArgs(arguments, 4) : [],
					setInterval = $window.setInterval,
					clearInterval = $window.clearInterval,
					iteration = 0,
					skipApply = (isDefined(invokeApply) && !invokeApply),
					deferred = (skipApply ? $$q : $q).defer(),
					promise = deferred.promise;

			count = isDefined(count) ? count : 0;

			promise.$$intervalId = setInterval(function tick() {
				if (skipApply) {
					$browser.defer(callback);
				} else {
					$rootScope.$evalAsync(callback);
				}
				deferred.notify(iteration++);

				if (count > 0 && iteration >= count) {
					deferred.resolve(iteration);
					clearInterval(promise.$$intervalId);
					delete intervals[promise.$$intervalId];
				}

				if (!skipApply) $rootScope.$apply();

			}, delay);

			intervals[promise.$$intervalId] = deferred;

			return promise;

			function callback() {
				if (!hasParams) {
					fn(iteration);
				} else {
					fn.apply(null, args);
				}
			}
		}

		interval.cancel = function(promise) {
			if (promise && promise.$$intervalId in intervals) {
				intervals[promise.$$intervalId].reject('canceled');
				$window.clearInterval(promise.$$intervalId);
				delete intervals[promise.$$intervalId];
				return true;
			}
			return false;
		};

		return interval;
	}];
}

var PATH_MATCH = /^([^\?#]*)(\?([^#]*))?(#(.*))?$/,
		DEFAULT_PORTS = {'http': 80, 'https': 443, 'ftp': 21};
var $locationMinErr = minErr('$location');

function encodePath(path) {
	var segments = path.split('/'),
			i = segments.length;

	while (i--) {
		segments[i] = encodeUriSegment(segments[i]);
	}

	return segments.join('/');
}

function parseAbsoluteUrl(absoluteUrl, locationObj) {
	var parsedUrl = urlResolve(absoluteUrl);

	locationObj.$$protocol = parsedUrl.protocol;
	locationObj.$$host = parsedUrl.hostname;
	locationObj.$$port = toInt(parsedUrl.port) || DEFAULT_PORTS[parsedUrl.protocol] || null;
}

function parseAppUrl(relativeUrl, locationObj) {
	var prefixed = (relativeUrl.charAt(0) !== '/');
	if (prefixed) {
		relativeUrl = '/' + relativeUrl;
	}
	var match = urlResolve(relativeUrl);
	locationObj.$$path = decodeURIComponent(prefixed && match.pathname.charAt(0) === '/' ?
			match.pathname.substring(1) : match.pathname);
	locationObj.$$search = parseKeyValue(match.search);
	locationObj.$$hash = decodeURIComponent(match.hash);

	// make sure path starts with '/';
	if (locationObj.$$path && locationObj.$$path.charAt(0) != '/') {
		locationObj.$$path = '/' + locationObj.$$path;
	}
}

function startsWith(haystack, needle) {
	return haystack.lastIndexOf(needle, 0) === 0;
}

function stripBaseUrl(base, url) {
	if (startsWith(url, base)) {
		return url.substr(base.length);
	}
}

function stripHash(url) {
	var index = url.indexOf('#');
	return index == -1 ? url : url.substr(0, index);
}

function trimEmptyHash(url) {
	return url.replace(/(#.+)|#$/, '$1');
}

function stripFile(url) {
	return url.substr(0, stripHash(url).lastIndexOf('/') + 1);
}

function serverBase(url) {
	return url.substring(0, url.indexOf('/', url.indexOf('//') + 2));
}

function LocationHtml5Url(appBase, appBaseNoFile, basePrefix) {
	this.$$html5 = true;
	basePrefix = basePrefix || '';
	parseAbsoluteUrl(appBase, this);

	this.$$parse = function(url) {
		var pathUrl = stripBaseUrl(appBaseNoFile, url);
		if (!isString(pathUrl)) {
			throw $locationMinErr('ipthprfx', 'Invalid url "{0}", missing path prefix "{1}".', url,
					appBaseNoFile);
		}

		parseAppUrl(pathUrl, this);

		if (!this.$$path) {
			this.$$path = '/';
		}

		this.$$compose();
	};

	this.$$compose = function() {
		var search = toKeyValue(this.$$search),
				hash = this.$$hash ? '#' + encodeUriSegment(this.$$hash) : '';

		this.$$url = encodePath(this.$$path) + (search ? '?' + search : '') + hash;
		this.$$absUrl = appBaseNoFile + this.$$url.substr(1); // first char is always '/'
	};

	this.$$parseLinkUrl = function(url, relHref) {
		if (relHref && relHref[0] === '#') {
			// special case for links to hash fragments:
			// keep the old url and only replace the hash fragment
			this.hash(relHref.slice(1));
			return true;
		}
		var appUrl, prevAppUrl;
		var rewrittenUrl;

		if (isDefined(appUrl = stripBaseUrl(appBase, url))) {
			prevAppUrl = appUrl;
			if (isDefined(appUrl = stripBaseUrl(basePrefix, appUrl))) {
				rewrittenUrl = appBaseNoFile + (stripBaseUrl('/', appUrl) || appUrl);
			} else {
				rewrittenUrl = appBase + prevAppUrl;
			}
		} else if (isDefined(appUrl = stripBaseUrl(appBaseNoFile, url))) {
			rewrittenUrl = appBaseNoFile + appUrl;
		} else if (appBaseNoFile == url + '/') {
			rewrittenUrl = appBaseNoFile;
		}
		if (rewrittenUrl) {
			this.$$parse(rewrittenUrl);
		}
		return !!rewrittenUrl;
	};
}

function LocationHashbangUrl(appBase, appBaseNoFile, hashPrefix) {

	parseAbsoluteUrl(appBase, this);

	this.$$parse = function(url) {
		var withoutBaseUrl = stripBaseUrl(appBase, url) || stripBaseUrl(appBaseNoFile, url);
		var withoutHashUrl;

		if (!isUndefined(withoutBaseUrl) && withoutBaseUrl.charAt(0) === '#') {

			// The rest of the url starts with a hash so we have
			// got either a hashbang path or a plain hash fragment
			withoutHashUrl = stripBaseUrl(hashPrefix, withoutBaseUrl);
			if (isUndefined(withoutHashUrl)) {
				// There was no hashbang prefix so we just have a hash fragment
				withoutHashUrl = withoutBaseUrl;
			}

		} else {
			// There was no hashbang path nor hash fragment:
			// If we are in HTML5 mode we use what is left as the path;
			// Otherwise we ignore what is left
			if (this.$$html5) {
				withoutHashUrl = withoutBaseUrl;
			} else {
				withoutHashUrl = '';
				if (isUndefined(withoutBaseUrl)) {
					appBase = url;
					this.replace();
				}
			}
		}

		parseAppUrl(withoutHashUrl, this);

		this.$$path = removeWindowsDriveName(this.$$path, withoutHashUrl, appBase);

		this.$$compose();

		function removeWindowsDriveName(path, url, base) {

			var windowsFilePathExp = /^\/[A-Z]:(\/.*)/;

			var firstPathSegmentMatch;

			//Get the relative path from the input URL.
			if (startsWith(url, base)) {
				url = url.replace(base, '');
			}

			// The input URL intentionally contains a first path segment that ends with a colon.
			if (windowsFilePathExp.exec(url)) {
				return path;
			}

			firstPathSegmentMatch = windowsFilePathExp.exec(path);
			return firstPathSegmentMatch ? firstPathSegmentMatch[1] : path;
		}
	};

	this.$$compose = function() {
		var search = toKeyValue(this.$$search),
				hash = this.$$hash ? '#' + encodeUriSegment(this.$$hash) : '';

		this.$$url = encodePath(this.$$path) + (search ? '?' + search : '') + hash;
		this.$$absUrl = appBase + (this.$$url ? hashPrefix + this.$$url : '');
	};

	this.$$parseLinkUrl = function(url, relHref) {
		if (stripHash(appBase) == stripHash(url)) {
			this.$$parse(url);
			return true;
		}
		return false;
	};
}

function LocationHashbangInHtml5Url(appBase, appBaseNoFile, hashPrefix) {
	this.$$html5 = true;
	LocationHashbangUrl.apply(this, arguments);

	this.$$parseLinkUrl = function(url, relHref) {
		if (relHref && relHref[0] === '#') {
			// special case for links to hash fragments:
			// keep the old url and only replace the hash fragment
			this.hash(relHref.slice(1));
			return true;
		}

		var rewrittenUrl;
		var appUrl;

		if (appBase == stripHash(url)) {
			rewrittenUrl = url;
		} else if ((appUrl = stripBaseUrl(appBaseNoFile, url))) {
			rewrittenUrl = appBase + hashPrefix + appUrl;
		} else if (appBaseNoFile === url + '/') {
			rewrittenUrl = appBaseNoFile;
		}
		if (rewrittenUrl) {
			this.$$parse(rewrittenUrl);
		}
		return !!rewrittenUrl;
	};

	this.$$compose = function() {
		var search = toKeyValue(this.$$search),
				hash = this.$$hash ? '#' + encodeUriSegment(this.$$hash) : '';

		this.$$url = encodePath(this.$$path) + (search ? '?' + search : '') + hash;
		// include hashPrefix in $$absUrl when $$url is empty so IE9 does not reload page because of removal of '#'
		this.$$absUrl = appBase + hashPrefix + this.$$url;
	};

}

var locationPrototype = {

	$$html5: false,

	$$replace: false,

	absUrl: locationGetter('$$absUrl'),

	url: function(url) {
		if (isUndefined(url)) {
			return this.$$url;
		}

		var match = PATH_MATCH.exec(url);
		if (match[1] || url === '') this.path(decodeURIComponent(match[1]));
		if (match[2] || match[1] || url === '') this.search(match[3] || '');
		this.hash(match[5] || '');

		return this;
	},

	protocol: locationGetter('$$protocol'),

	host: locationGetter('$$host'),

	port: locationGetter('$$port'),

	path: locationGetterSetter('$$path', function(path) {
		path = path !== null ? path.toString() : '';
		return path.charAt(0) == '/' ? path : '/' + path;
	}),

	search: function(search, paramValue) {
		switch (arguments.length) {
			case 0:
				return this.$$search;
			case 1:
				if (isString(search) || isNumber(search)) {
					search = search.toString();
					this.$$search = parseKeyValue(search);
				} else if (isObject(search)) {
					search = copy(search, {});
					// remove object undefined or null properties
					forEach(search, function(value, key) {
						if (value == null) delete search[key];
					});

					this.$$search = search;
				} else {
					throw $locationMinErr('isrcharg',
							'The first argument of the `$location#search()` call must be a string or an object.');
				}
				break;
			default:
				if (isUndefined(paramValue) || paramValue === null) {
					delete this.$$search[search];
				} else {
					this.$$search[search] = paramValue;
				}
		}

		this.$$compose();
		return this;
	},

	hash: locationGetterSetter('$$hash', function(hash) {
		return hash !== null ? hash.toString() : '';
	}),

	replace: function() {
		this.$$replace = true;
		return this;
	}
};

forEach([LocationHashbangInHtml5Url, LocationHashbangUrl, LocationHtml5Url], function(Location) {
	Location.prototype = Object.create(locationPrototype);

	Location.prototype.state = function(state) {
		if (!arguments.length) {
			return this.$$state;
		}

		if (Location !== LocationHtml5Url || !this.$$html5) {
			throw $locationMinErr('nostate', 'History API state support is available only ' +
				'in HTML5 mode and only in browsers supporting HTML5 History API');
		}
		// The user might modify `stateObject` after invoking `$location.state(stateObject)`
		// but we're changing the $$state reference to $browser.state() during the $digest
		// so the modification window is narrow.
		this.$$state = isUndefined(state) ? null : state;

		return this;
	};
});

function locationGetter(property) {
	return function() {
		return this[property];
	};
}

function locationGetterSetter(property, preprocess) {
	return function(value) {
		if (isUndefined(value)) {
			return this[property];
		}

		this[property] = preprocess(value);
		this.$$compose();

		return this;
	};
}

function $LocationProvider() {
	var hashPrefix = '',
			html5Mode = {
				enabled: false,
				requireBase: true,
				rewriteLinks: true
			};

	this.hashPrefix = function(prefix) {
		if (isDefined(prefix)) {
			hashPrefix = prefix;
			return this;
		} else {
			return hashPrefix;
		}
	};

	this.html5Mode = function(mode) {
		if (isBoolean(mode)) {
			html5Mode.enabled = mode;
			return this;
		} else if (isObject(mode)) {

			if (isBoolean(mode.enabled)) {
				html5Mode.enabled = mode.enabled;
			}

			if (isBoolean(mode.requireBase)) {
				html5Mode.requireBase = mode.requireBase;
			}

			if (isBoolean(mode.rewriteLinks)) {
				html5Mode.rewriteLinks = mode.rewriteLinks;
			}

			return this;
		} else {
			return html5Mode;
		}
	};

	this.$get = ['$rootScope', '$browser', '$sniffer', '$rootElement', '$window',
			function($rootScope, $browser, $sniffer, $rootElement, $window) {
		var $location,
				LocationMode,
				baseHref = $browser.baseHref(), // if base[href] is undefined, it defaults to ''
				initialUrl = $browser.url(),
				appBase;

		if (html5Mode.enabled) {
			if (!baseHref && html5Mode.requireBase) {
				throw $locationMinErr('nobase',
					"$location in HTML5 mode requires a <base> tag to be present!");
			}
			appBase = serverBase(initialUrl) + (baseHref || '/');
			LocationMode = $sniffer.history ? LocationHtml5Url : LocationHashbangInHtml5Url;
		} else {
			appBase = stripHash(initialUrl);
			LocationMode = LocationHashbangUrl;
		}
		var appBaseNoFile = stripFile(appBase);

		$location = new LocationMode(appBase, appBaseNoFile, '#' + hashPrefix);
		$location.$$parseLinkUrl(initialUrl, initialUrl);

		$location.$$state = $browser.state();

		var IGNORE_URI_REGEXP = /^\s*(javascript|mailto):/i;

		function setBrowserUrlWithFallback(url, replace, state) {
			var oldUrl = $location.url();
			var oldState = $location.$$state;
			try {
				$browser.url(url, replace, state);

				// Make sure $location.state() returns referentially identical (not just deeply equal)
				// state object; this makes possible quick checking if the state changed in the digest
				// loop. Checking deep equality would be too expensive.
				$location.$$state = $browser.state();
			} catch (e) {
				// Restore old values if pushState fails
				$location.url(oldUrl);
				$location.$$state = oldState;

				throw e;
			}
		}

		$rootElement.on('click', function(event) {
			// TODO(vojta): rewrite link when opening in new tab/window (in legacy browser)
			// currently we open nice url link and redirect then

			if (!html5Mode.rewriteLinks || event.ctrlKey || event.metaKey || event.shiftKey || event.which == 2 || event.button == 2) return;

			var elm = jqLite(event.target);

			// traverse the DOM up to find first A tag
			while (nodeName_(elm[0]) !== 'a') {
				// ignore rewriting if no A tag (reached root element, or no parent - removed from document)
				if (elm[0] === $rootElement[0] || !(elm = elm.parent())[0]) return;
			}

			var absHref = elm.prop('href');
			// get the actual href attribute - see
			// http://msdn.microsoft.com/en-us/library/ie/dd347148(v=vs.85).aspx
			var relHref = elm.attr('href') || elm.attr('xlink:href');

			if (isObject(absHref) && absHref.toString() === '[object SVGAnimatedString]') {
				// SVGAnimatedString.animVal should be identical to SVGAnimatedString.baseVal, unless during
				// an animation.
				absHref = urlResolve(absHref.animVal).href;
			}

			// Ignore when url is started with javascript: or mailto:
			if (IGNORE_URI_REGEXP.test(absHref)) return;

			if (absHref && !elm.attr('target') && !event.isDefaultPrevented()) {
				if ($location.$$parseLinkUrl(absHref, relHref)) {
					// We do a preventDefault for all urls that are part of the angular application,
					// in html5mode and also without, so that we are able to abort navigation without
					// getting double entries in the location history.
					event.preventDefault();
					// update location manually
					if ($location.absUrl() != $browser.url()) {
						$rootScope.$apply();
						// hack to work around FF6 bug 684208 when scenario runner clicks on links
						$window.angular['ff-684208-preventDefault'] = true;
					}
				}
			}
		});

		// rewrite hashbang url <> html5 url
		if (trimEmptyHash($location.absUrl()) != trimEmptyHash(initialUrl)) {
			$browser.url($location.absUrl(), true);
		}

		var initializing = true;

		// update $location when $browser url changes
		$browser.onUrlChange(function(newUrl, newState) {

			if (isUndefined(stripBaseUrl(appBaseNoFile, newUrl))) {
				// If we are navigating outside of the app then force a reload
				$window.location.href = newUrl;
				return;
			}

			$rootScope.$evalAsync(function() {
				var oldUrl = $location.absUrl();
				var oldState = $location.$$state;
				var defaultPrevented;
				newUrl = trimEmptyHash(newUrl);
				$location.$$parse(newUrl);
				$location.$$state = newState;

				defaultPrevented = $rootScope.$broadcast('$locationChangeStart', newUrl, oldUrl,
						newState, oldState).defaultPrevented;

				// if the location was changed by a `$locationChangeStart` handler then stop
				// processing this location change
				if ($location.absUrl() !== newUrl) return;

				if (defaultPrevented) {
					$location.$$parse(oldUrl);
					$location.$$state = oldState;
					setBrowserUrlWithFallback(oldUrl, false, oldState);
				} else {
					initializing = false;
					afterLocationChange(oldUrl, oldState);
				}
			});
			if (!$rootScope.$$phase) $rootScope.$digest();
		});

		// update browser
		$rootScope.$watch(function $locationWatch() {
			var oldUrl = trimEmptyHash($browser.url());
			var newUrl = trimEmptyHash($location.absUrl());
			var oldState = $browser.state();
			var currentReplace = $location.$$replace;
			var urlOrStateChanged = oldUrl !== newUrl ||
				($location.$$html5 && $sniffer.history && oldState !== $location.$$state);

			if (initializing || urlOrStateChanged) {
				initializing = false;

				$rootScope.$evalAsync(function() {
					var newUrl = $location.absUrl();
					var defaultPrevented = $rootScope.$broadcast('$locationChangeStart', newUrl, oldUrl,
							$location.$$state, oldState).defaultPrevented;

					// if the location was changed by a `$locationChangeStart` handler then stop
					// processing this location change
					if ($location.absUrl() !== newUrl) return;

					if (defaultPrevented) {
						$location.$$parse(oldUrl);
						$location.$$state = oldState;
					} else {
						if (urlOrStateChanged) {
							setBrowserUrlWithFallback(newUrl, currentReplace,
																				oldState === $location.$$state ? null : $location.$$state);
						}
						afterLocationChange(oldUrl, oldState);
					}
				});
			}

			$location.$$replace = false;

			// we don't need to return anything because $evalAsync will make the digest loop dirty when
			// there is a change
		});

		return $location;

		function afterLocationChange(oldUrl, oldState) {
			$rootScope.$broadcast('$locationChangeSuccess', $location.absUrl(), oldUrl,
				$location.$$state, oldState);
		}
}];
}

function $LogProvider() {
	var debug = true,
			self = this;

	this.debugEnabled = function(flag) {
		if (isDefined(flag)) {
			debug = flag;
		return this;
		} else {
			return debug;
		}
	};

	this.$get = ['$window', function($window) {
		return {

			log: consoleLog('log'),

			info: consoleLog('info'),

			warn: consoleLog('warn'),

			error: consoleLog('error'),

			debug: (function() {
				var fn = consoleLog('debug');

				return function() {
					if (debug) {
						fn.apply(self, arguments);
					}
				};
			}())
		};

		function formatError(arg) {
			if (arg instanceof Error) {
				if (arg.stack) {
					arg = (arg.message && arg.stack.indexOf(arg.message) === -1)
							? 'Error: ' + arg.message + '\n' + arg.stack
							: arg.stack;
				} else if (arg.sourceURL) {
					arg = arg.message + '\n' + arg.sourceURL + ':' + arg.line;
				}
			}
			return arg;
		}

		function consoleLog(type) {
			var console = $window.console || {},
					logFn = console[type] || console.log || noop,
					hasApply = false;

			// Note: reading logFn.apply throws an error in IE11 in IE8 document mode.
			// The reason behind this is that console.log has type "object" in IE8...
			try {
				hasApply = !!logFn.apply;
			} catch (e) {}

			if (hasApply) {
				return function() {
					var args = [];
					forEach(arguments, function(arg) {
						args.push(formatError(arg));
					});
					return logFn.apply(console, args);
				};
			}

			// we are IE which either doesn't have window.console => this is noop and we do nothing,
			// or we are IE where console.log doesn't have apply so we log at least first 2 args
			return function(arg1, arg2) {
				logFn(arg1, arg2 == null ? '' : arg2);
			};
		}
	}];
}

var $parseMinErr = minErr('$parse');

// Sandboxing Angular Expressions
// ------------------------------
// Angular expressions are generally considered safe because these expressions only have direct
// access to `$scope` and locals. However, one can obtain the ability to execute arbitrary JS code by
// obtaining a reference to native JS functions such as the Function constructor.
//
// As an example, consider the following Angular expression:
//
//   {}.toString.constructor('alert("evil JS code")')
//
// This sandboxing technique is not perfect and doesn't aim to be. The goal is to prevent exploits
// against the expression language, but not to prevent exploits that were enabled by exposing
// sensitive JavaScript or browser APIs on Scope. Exposing such objects on a Scope is never a good
// practice and therefore we are not even trying to protect against interaction with an object
// explicitly exposed in this way.
//
// In general, it is not possible to access a Window object from an angular expression unless a
// window or some DOM object that has a reference to window is published onto a Scope.
// Similarly we prevent invocations of function known to be dangerous, as well as assignments to
// native objects.
//
// See https://docs.angularjs.org/guide/security

function ensureSafeMemberName(name, fullExpression) {
	if (name === "__defineGetter__" || name === "__defineSetter__"
			|| name === "__lookupGetter__" || name === "__lookupSetter__"
			|| name === "__proto__") {
		throw $parseMinErr('isecfld',
				'Attempting to access a disallowed field in Angular expressions! '
				+ 'Expression: {0}', fullExpression);
	}
	return name;
}

function getStringValue(name) {
	// Property names must be strings. This means that non-string objects cannot be used
	// as keys in an object. Any non-string object, including a number, is typecasted
	// into a string via the toString method.
	// -- MDN, https://developer.mozilla.org/en/docs/Web/JavaScript/Reference/Operators/Property_accessors#Property_names
	//
	// So, to ensure that we are checking the same `name` that JavaScript would use, we cast it
	// to a string. It's not always possible. If `name` is an object and its `toString` method is
	// 'broken' (doesn't return a string, isn't a function, etc.), an error will be thrown:
	//
	// TypeError: Cannot convert object to primitive value
	//
	// For performance reasons, we don't catch this error here and allow it to propagate up the call
	// stack. Note that you'll get the same error in JavaScript if you try to access a property using
	// such a 'broken' object as a key.
	return name + '';
}

function ensureSafeObject(obj, fullExpression) {
	// nifty check if obj is Function that is fast and works across iframes and other contexts
	if (obj) {
		if (obj.constructor === obj) {
			throw $parseMinErr('isecfn',
					'Referencing Function in Angular expressions is disallowed! Expression: {0}',
					fullExpression);
		} else if (// isWindow(obj)
				obj.window === obj) {
			throw $parseMinErr('isecwindow',
					'Referencing the Window in Angular expressions is disallowed! Expression: {0}',
					fullExpression);
		} else if (// isElement(obj)
				obj.children && (obj.nodeName || (obj.prop && obj.attr && obj.find))) {
			throw $parseMinErr('isecdom',
					'Referencing DOM nodes in Angular expressions is disallowed! Expression: {0}',
					fullExpression);
		} else if (// block Object so that we can't get hold of dangerous Object.* methods
				obj === Object) {
			throw $parseMinErr('isecobj',
					'Referencing Object in Angular expressions is disallowed! Expression: {0}',
					fullExpression);
		}
	}
	return obj;
}

var CALL = Function.prototype.call;
var APPLY = Function.prototype.apply;
var BIND = Function.prototype.bind;

function ensureSafeFunction(obj, fullExpression) {
	if (obj) {
		if (obj.constructor === obj) {
			throw $parseMinErr('isecfn',
				'Referencing Function in Angular expressions is disallowed! Expression: {0}',
				fullExpression);
		} else if (obj === CALL || obj === APPLY || obj === BIND) {
			throw $parseMinErr('isecff',
				'Referencing call, apply or bind in Angular expressions is disallowed! Expression: {0}',
				fullExpression);
		}
	}
}

function ensureSafeAssignContext(obj, fullExpression) {
	if (obj) {
		if (obj === (0).constructor || obj === (false).constructor || obj === ''.constructor ||
				obj === {}.constructor || obj === [].constructor || obj === Function.constructor) {
			throw $parseMinErr('isecaf',
				'Assigning to a constructor is disallowed! Expression: {0}', fullExpression);
		}
	}
}

var OPERATORS = createMap();
forEach('+ - * / % === !== == != < > <= >= && || ! = |'.split(' '), function(operator) { OPERATORS[operator] = true; });
var ESCAPE = {"n":"\n", "f":"\f", "r":"\r", "t":"\t", "v":"\v", "'":"'", '"':'"'};

/////////////////////////////////////////

var Lexer = function(options) {
	this.options = options;
};

Lexer.prototype = {
	constructor: Lexer,

	lex: function(text) {
		this.text = text;
		this.index = 0;
		this.tokens = [];

		while (this.index < this.text.length) {
			var ch = this.text.charAt(this.index);
			if (ch === '"' || ch === "'") {
				this.readString(ch);
			} else if (this.isNumber(ch) || ch === '.' && this.isNumber(this.peek())) {
				this.readNumber();
			} else if (this.isIdentifierStart(this.peekMultichar())) {
				this.readIdent();
			} else if (this.is(ch, '(){}[].,;:?')) {
				this.tokens.push({index: this.index, text: ch});
				this.index++;
			} else if (this.isWhitespace(ch)) {
				this.index++;
			} else {
				var ch2 = ch + this.peek();
				var ch3 = ch2 + this.peek(2);
				var op1 = OPERATORS[ch];
				var op2 = OPERATORS[ch2];
				var op3 = OPERATORS[ch3];
				if (op1 || op2 || op3) {
					var token = op3 ? ch3 : (op2 ? ch2 : ch);
					this.tokens.push({index: this.index, text: token, operator: true});
					this.index += token.length;
				} else {
					this.throwError('Unexpected next character ', this.index, this.index + 1);
				}
			}
		}
		return this.tokens;
	},

	is: function(ch, chars) {
		return chars.indexOf(ch) !== -1;
	},

	peek: function(i) {
		var num = i || 1;
		return (this.index + num < this.text.length) ? this.text.charAt(this.index + num) : false;
	},

	isNumber: function(ch) {
		return ('0' <= ch && ch <= '9') && typeof ch === "string";
	},

	isWhitespace: function(ch) {
		// IE treats non-breaking space as \u00A0
		return (ch === ' ' || ch === '\r' || ch === '\t' ||
						ch === '\n' || ch === '\v' || ch === '\u00A0');
	},

	isIdentifierStart: function(ch) {
		return this.options.isIdentifierStart ?
				this.options.isIdentifierStart(ch, this.codePointAt(ch)) :
				this.isValidIdentifierStart(ch);
	},

	isValidIdentifierStart: function(ch) {
		return ('a' <= ch && ch <= 'z' ||
						'A' <= ch && ch <= 'Z' ||
						'_' === ch || ch === '$');
	},

	isIdentifierContinue: function(ch) {
		return this.options.isIdentifierContinue ?
				this.options.isIdentifierContinue(ch, this.codePointAt(ch)) :
				this.isValidIdentifierContinue(ch);
	},

	isValidIdentifierContinue: function(ch, cp) {
		return this.isValidIdentifierStart(ch, cp) || this.isNumber(ch);
	},

	codePointAt: function(ch) {
		if (ch.length === 1) return ch.charCodeAt(0);

		return (ch.charCodeAt(0) << 10) + ch.charCodeAt(1) - 0x35FDC00;

	},

	peekMultichar: function() {
		var ch = this.text.charAt(this.index);
		var peek = this.peek();
		if (!peek) {
			return ch;
		}
		var cp1 = ch.charCodeAt(0);
		var cp2 = peek.charCodeAt(0);
		if (cp1 >= 0xD800 && cp1 <= 0xDBFF && cp2 >= 0xDC00 && cp2 <= 0xDFFF) {
			return ch + peek;
		}
		return ch;
	},

	isExpOperator: function(ch) {
		return (ch === '-' || ch === '+' || this.isNumber(ch));
	},

	throwError: function(error, start, end) {
		end = end || this.index;
		var colStr = (isDefined(start)
						? 's ' + start +  '-' + this.index + ' [' + this.text.substring(start, end) + ']'
						: ' ' + end);
		throw $parseMinErr('lexerr', 'Lexer Error: {0} at column{1} in expression [{2}].',
				error, colStr, this.text);
	},

	readNumber: function() {
		var number = '';
		var start = this.index;
		while (this.index < this.text.length) {
			var ch = lowercase(this.text.charAt(this.index));
			if (ch == '.' || this.isNumber(ch)) {
				number += ch;
			} else {
				var peekCh = this.peek();
				if (ch == 'e' && this.isExpOperator(peekCh)) {
					number += ch;
				} else if (this.isExpOperator(ch) &&
						peekCh && this.isNumber(peekCh) &&
						number.charAt(number.length - 1) == 'e') {
					number += ch;
				} else if (this.isExpOperator(ch) &&
						(!peekCh || !this.isNumber(peekCh)) &&
						number.charAt(number.length - 1) == 'e') {
					this.throwError('Invalid exponent');
				} else {
					break;
				}
			}
			this.index++;
		}
		this.tokens.push({
			index: start,
			text: number,
			constant: true,
			value: Number(number)
		});
	},

	readIdent: function() {
		var start = this.index;
		this.index += this.peekMultichar().length;
		while (this.index < this.text.length) {
			var ch = this.peekMultichar();
			if (!this.isIdentifierContinue(ch)) {
				break;
			}
			this.index += ch.length;
		}
		this.tokens.push({
			index: start,
			text: this.text.slice(start, this.index),
			identifier: true
		});
	},

	readString: function(quote) {
		var start = this.index;
		this.index++;
		var string = '';
		var rawString = quote;
		var escape = false;
		while (this.index < this.text.length) {
			var ch = this.text.charAt(this.index);
			rawString += ch;
			if (escape) {
				if (ch === 'u') {
					var hex = this.text.substring(this.index + 1, this.index + 5);
					if (!hex.match(/[\da-f]{4}/i)) {
						this.throwError('Invalid unicode escape [\\u' + hex + ']');
					}
					this.index += 4;
					string += String.fromCharCode(parseInt(hex, 16));
				} else {
					var rep = ESCAPE[ch];
					string = string + (rep || ch);
				}
				escape = false;
			} else if (ch === '\\') {
				escape = true;
			} else if (ch === quote) {
				this.index++;
				this.tokens.push({
					index: start,
					text: rawString,
					constant: true,
					value: string
				});
				return;
			} else {
				string += ch;
			}
			this.index++;
		}
		this.throwError('Unterminated quote', start);
	}
};

var AST = function(lexer, options) {
	this.lexer = lexer;
	this.options = options;
};

AST.Program = 'Program';
AST.ExpressionStatement = 'ExpressionStatement';
AST.AssignmentExpression = 'AssignmentExpression';
AST.ConditionalExpression = 'ConditionalExpression';
AST.LogicalExpression = 'LogicalExpression';
AST.BinaryExpression = 'BinaryExpression';
AST.UnaryExpression = 'UnaryExpression';
AST.CallExpression = 'CallExpression';
AST.MemberExpression = 'MemberExpression';
AST.Identifier = 'Identifier';
AST.Literal = 'Literal';
AST.ArrayExpression = 'ArrayExpression';
AST.Property = 'Property';
AST.ObjectExpression = 'ObjectExpression';
AST.ThisExpression = 'ThisExpression';
AST.LocalsExpression = 'LocalsExpression';

// Internal use only
AST.NGValueParameter = 'NGValueParameter';

AST.prototype = {
	ast: function(text) {
		this.text = text;
		this.tokens = this.lexer.lex(text);

		var value = this.program();

		if (this.tokens.length !== 0) {
			this.throwError('is an unexpected token', this.tokens[0]);
		}

		return value;
	},

	program: function() {
		var body = [];
		while (true) {
			if (this.tokens.length > 0 && !this.peek('}', ')', ';', ']'))
				body.push(this.expressionStatement());
			if (!this.expect(';')) {
				return { type: AST.Program, body: body};
			}
		}
	},

	expressionStatement: function() {
		return { type: AST.ExpressionStatement, expression: this.filterChain() };
	},

	filterChain: function() {
		var left = this.expression();
		var token;
		while ((token = this.expect('|'))) {
			left = this.filter(left);
		}
		return left;
	},

	expression: function() {
		return this.assignment();
	},

	assignment: function() {
		var result = this.ternary();
		if (this.expect('=')) {
			result = { type: AST.AssignmentExpression, left: result, right: this.assignment(), operator: '='};
		}
		return result;
	},

	ternary: function() {
		var test = this.logicalOR();
		var alternate;
		var consequent;
		if (this.expect('?')) {
			alternate = this.expression();
			if (this.consume(':')) {
				consequent = this.expression();
				return { type: AST.ConditionalExpression, test: test, alternate: alternate, consequent: consequent};
			}
		}
		return test;
	},

	logicalOR: function() {
		var left = this.logicalAND();
		while (this.expect('||')) {
			left = { type: AST.LogicalExpression, operator: '||', left: left, right: this.logicalAND() };
		}
		return left;
	},

	logicalAND: function() {
		var left = this.equality();
		while (this.expect('&&')) {
			left = { type: AST.LogicalExpression, operator: '&&', left: left, right: this.equality()};
		}
		return left;
	},

	equality: function() {
		var left = this.relational();
		var token;
		while ((token = this.expect('==','!=','===','!=='))) {
			left = { type: AST.BinaryExpression, operator: token.text, left: left, right: this.relational() };
		}
		return left;
	},

	relational: function() {
		var left = this.additive();
		var token;
		while ((token = this.expect('<', '>', '<=', '>='))) {
			left = { type: AST.BinaryExpression, operator: token.text, left: left, right: this.additive() };
		}
		return left;
	},

	additive: function() {
		var left = this.multiplicative();
		var token;
		while ((token = this.expect('+','-'))) {
			left = { type: AST.BinaryExpression, operator: token.text, left: left, right: this.multiplicative() };
		}
		return left;
	},

	multiplicative: function() {
		var left = this.unary();
		var token;
		while ((token = this.expect('*','/','%'))) {
			left = { type: AST.BinaryExpression, operator: token.text, left: left, right: this.unary() };
		}
		return left;
	},

	unary: function() {
		var token;
		if ((token = this.expect('+', '-', '!'))) {
			return { type: AST.UnaryExpression, operator: token.text, prefix: true, argument: this.unary() };
		} else {
			return this.primary();
		}
	},

	primary: function() {
		var primary;
		if (this.expect('(')) {
			primary = this.filterChain();
			this.consume(')');
		} else if (this.expect('[')) {
			primary = this.arrayDeclaration();
		} else if (this.expect('{')) {
			primary = this.object();
		} else if (this.selfReferential.hasOwnProperty(this.peek().text)) {
			primary = copy(this.selfReferential[this.consume().text]);
		} else if (this.options.literals.hasOwnProperty(this.peek().text)) {
			primary = { type: AST.Literal, value: this.options.literals[this.consume().text]};
		} else if (this.peek().identifier) {
			primary = this.identifier();
		} else if (this.peek().constant) {
			primary = this.constant();
		} else {
			this.throwError('not a primary expression', this.peek());
		}

		var next;
		while ((next = this.expect('(', '[', '.'))) {
			if (next.text === '(') {
				primary = {type: AST.CallExpression, callee: primary, arguments: this.parseArguments() };
				this.consume(')');
			} else if (next.text === '[') {
				primary = { type: AST.MemberExpression, object: primary, property: this.expression(), computed: true };
				this.consume(']');
			} else if (next.text === '.') {
				primary = { type: AST.MemberExpression, object: primary, property: this.identifier(), computed: false };
			} else {
				this.throwError('IMPOSSIBLE');
			}
		}
		return primary;
	},

	filter: function(baseExpression) {
		var args = [baseExpression];
		var result = {type: AST.CallExpression, callee: this.identifier(), arguments: args, filter: true};

		while (this.expect(':')) {
			args.push(this.expression());
		}

		return result;
	},

	parseArguments: function() {
		var args = [];
		if (this.peekToken().text !== ')') {
			do {
				args.push(this.expression());
			} while (this.expect(','));
		}
		return args;
	},

	identifier: function() {
		var token = this.consume();
		if (!token.identifier) {
			this.throwError('is not a valid identifier', token);
		}
		return { type: AST.Identifier, name: token.text };
	},

	constant: function() {
		// TODO check that it is a constant
		return { type: AST.Literal, value: this.consume().value };
	},

	arrayDeclaration: function() {
		var elements = [];
		if (this.peekToken().text !== ']') {
			do {
				if (this.peek(']')) {
					// Support trailing commas per ES5.1.
					break;
				}
				elements.push(this.expression());
			} while (this.expect(','));
		}
		this.consume(']');

		return { type: AST.ArrayExpression, elements: elements };
	},

	object: function() {
		var properties = [], property;
		if (this.peekToken().text !== '}') {
			do {
				if (this.peek('}')) {
					// Support trailing commas per ES5.1.
					break;
				}
				property = {type: AST.Property, kind: 'init'};
				if (this.peek().constant) {
					property.key = this.constant();
					property.computed = false;
					this.consume(':');
					property.value = this.expression();
				} else if (this.peek().identifier) {
					property.key = this.identifier();
					property.computed = false;
					if (this.peek(':')) {
						this.consume(':');
						property.value = this.expression();
					} else {
						property.value = property.key;
					}
				} else if (this.peek('[')) {
					this.consume('[');
					property.key = this.expression();
					this.consume(']');
					property.computed = true;
					this.consume(':');
					property.value = this.expression();
				} else {
					this.throwError("invalid key", this.peek());
				}
				properties.push(property);
			} while (this.expect(','));
		}
		this.consume('}');

		return {type: AST.ObjectExpression, properties: properties };
	},

	throwError: function(msg, token) {
		throw $parseMinErr('syntax',
				'Syntax Error: Token \'{0}\' {1} at column {2} of the expression [{3}] starting at [{4}].',
					token.text, msg, (token.index + 1), this.text, this.text.substring(token.index));
	},

	consume: function(e1) {
		if (this.tokens.length === 0) {
			throw $parseMinErr('ueoe', 'Unexpected end of expression: {0}', this.text);
		}

		var token = this.expect(e1);
		if (!token) {
			this.throwError('is unexpected, expecting [' + e1 + ']', this.peek());
		}
		return token;
	},

	peekToken: function() {
		if (this.tokens.length === 0) {
			throw $parseMinErr('ueoe', 'Unexpected end of expression: {0}', this.text);
		}
		return this.tokens[0];
	},

	peek: function(e1, e2, e3, e4) {
		return this.peekAhead(0, e1, e2, e3, e4);
	},

	peekAhead: function(i, e1, e2, e3, e4) {
		if (this.tokens.length > i) {
			var token = this.tokens[i];
			var t = token.text;
			if (t === e1 || t === e2 || t === e3 || t === e4 ||
					(!e1 && !e2 && !e3 && !e4)) {
				return token;
			}
		}
		return false;
	},

	expect: function(e1, e2, e3, e4) {
		var token = this.peek(e1, e2, e3, e4);
		if (token) {
			this.tokens.shift();
			return token;
		}
		return false;
	},

	selfReferential: {
		'this': {type: AST.ThisExpression },
		'$locals': {type: AST.LocalsExpression }
	}
};

function ifDefined(v, d) {
	return typeof v !== 'undefined' ? v : d;
}

function plusFn(l, r) {
	if (typeof l === 'undefined') return r;
	if (typeof r === 'undefined') return l;
	return l + r;
}

function isStateless($filter, filterName) {
	var fn = $filter(filterName);
	return !fn.$stateful;
}

function findConstantAndWatchExpressions(ast, $filter) {
	var allConstants;
	var argsToWatch;
	switch (ast.type) {
	case AST.Program:
		allConstants = true;
		forEach(ast.body, function(expr) {
			findConstantAndWatchExpressions(expr.expression, $filter);
			allConstants = allConstants && expr.expression.constant;
		});
		ast.constant = allConstants;
		break;
	case AST.Literal:
		ast.constant = true;
		ast.toWatch = [];
		break;
	case AST.UnaryExpression:
		findConstantAndWatchExpressions(ast.argument, $filter);
		ast.constant = ast.argument.constant;
		ast.toWatch = ast.argument.toWatch;
		break;
	case AST.BinaryExpression:
		findConstantAndWatchExpressions(ast.left, $filter);
		findConstantAndWatchExpressions(ast.right, $filter);
		ast.constant = ast.left.constant && ast.right.constant;
		ast.toWatch = ast.left.toWatch.concat(ast.right.toWatch);
		break;
	case AST.LogicalExpression:
		findConstantAndWatchExpressions(ast.left, $filter);
		findConstantAndWatchExpressions(ast.right, $filter);
		ast.constant = ast.left.constant && ast.right.constant;
		ast.toWatch = ast.constant ? [] : [ast];
		break;
	case AST.ConditionalExpression:
		findConstantAndWatchExpressions(ast.test, $filter);
		findConstantAndWatchExpressions(ast.alternate, $filter);
		findConstantAndWatchExpressions(ast.consequent, $filter);
		ast.constant = ast.test.constant && ast.alternate.constant && ast.consequent.constant;
		ast.toWatch = ast.constant ? [] : [ast];
		break;
	case AST.Identifier:
		ast.constant = false;
		ast.toWatch = [ast];
		break;
	case AST.MemberExpression:
		findConstantAndWatchExpressions(ast.object, $filter);
		if (ast.computed) {
			findConstantAndWatchExpressions(ast.property, $filter);
		}
		ast.constant = ast.object.constant && (!ast.computed || ast.property.constant);
		ast.toWatch = [ast];
		break;
	case AST.CallExpression:
		allConstants = ast.filter ? isStateless($filter, ast.callee.name) : false;
		argsToWatch = [];
		forEach(ast.arguments, function(expr) {
			findConstantAndWatchExpressions(expr, $filter);
			allConstants = allConstants && expr.constant;
			if (!expr.constant) {
				argsToWatch.push.apply(argsToWatch, expr.toWatch);
			}
		});
		ast.constant = allConstants;
		ast.toWatch = ast.filter && isStateless($filter, ast.callee.name) ? argsToWatch : [ast];
		break;
	case AST.AssignmentExpression:
		findConstantAndWatchExpressions(ast.left, $filter);
		findConstantAndWatchExpressions(ast.right, $filter);
		ast.constant = ast.left.constant && ast.right.constant;
		ast.toWatch = [ast];
		break;
	case AST.ArrayExpression:
		allConstants = true;
		argsToWatch = [];
		forEach(ast.elements, function(expr) {
			findConstantAndWatchExpressions(expr, $filter);
			allConstants = allConstants && expr.constant;
			if (!expr.constant) {
				argsToWatch.push.apply(argsToWatch, expr.toWatch);
			}
		});
		ast.constant = allConstants;
		ast.toWatch = argsToWatch;
		break;
	case AST.ObjectExpression:
		allConstants = true;
		argsToWatch = [];
		forEach(ast.properties, function(property) {
			findConstantAndWatchExpressions(property.value, $filter);
			allConstants = allConstants && property.value.constant && !property.computed;
			if (!property.value.constant) {
				argsToWatch.push.apply(argsToWatch, property.value.toWatch);
			}
		});
		ast.constant = allConstants;
		ast.toWatch = argsToWatch;
		break;
	case AST.ThisExpression:
		ast.constant = false;
		ast.toWatch = [];
		break;
	case AST.LocalsExpression:
		ast.constant = false;
		ast.toWatch = [];
		break;
	}
}

function getInputs(body) {
	if (body.length != 1) return;
	var lastExpression = body[0].expression;
	var candidate = lastExpression.toWatch;
	if (candidate.length !== 1) return candidate;
	return candidate[0] !== lastExpression ? candidate : undefined;
}

function isAssignable(ast) {
	return ast.type === AST.Identifier || ast.type === AST.MemberExpression;
}

function assignableAST(ast) {
	if (ast.body.length === 1 && isAssignable(ast.body[0].expression)) {
		return {type: AST.AssignmentExpression, left: ast.body[0].expression, right: {type: AST.NGValueParameter}, operator: '='};
	}
}

function isLiteral(ast) {
	return ast.body.length === 0 ||
			ast.body.length === 1 && (
			ast.body[0].expression.type === AST.Literal ||
			ast.body[0].expression.type === AST.ArrayExpression ||
			ast.body[0].expression.type === AST.ObjectExpression);
}

function isConstant(ast) {
	return ast.constant;
}

function ASTCompiler(astBuilder, $filter) {
	this.astBuilder = astBuilder;
	this.$filter = $filter;
}

ASTCompiler.prototype = {
	compile: function(expression, expensiveChecks) {
		var self = this;
		var ast = this.astBuilder.ast(expression);
		this.state = {
			nextId: 0,
			filters: {},
			expensiveChecks: expensiveChecks,
			fn: {vars: [], body: [], own: {}},
			assign: {vars: [], body: [], own: {}},
			inputs: []
		};
		findConstantAndWatchExpressions(ast, self.$filter);
		var extra = '';
		var assignable;
		this.stage = 'assign';
		if ((assignable = assignableAST(ast))) {
			this.state.computing = 'assign';
			var result = this.nextId();
			this.recurse(assignable, result);
			this.return_(result);
			extra = 'fn.assign=' + this.generateFunction('assign', 's,v,l');
		}
		var toWatch = getInputs(ast.body);
		self.stage = 'inputs';
		forEach(toWatch, function(watch, key) {
			var fnKey = 'fn' + key;
			self.state[fnKey] = {vars: [], body: [], own: {}};
			self.state.computing = fnKey;
			var intoId = self.nextId();
			self.recurse(watch, intoId);
			self.return_(intoId);
			self.state.inputs.push(fnKey);
			watch.watchId = key;
		});
		this.state.computing = 'fn';
		this.stage = 'main';
		this.recurse(ast);
		var fnString =
			// The build and minification steps remove the string "use strict" from the code, but this is done using a regex.
			// This is a workaround for this until we do a better job at only removing the prefix only when we should.
			'"' + this.USE + ' ' + this.STRICT + '";\n' +
			this.filterPrefix() +
			'var fn=' + this.generateFunction('fn', 's,l,a,i') +
			extra +
			this.watchFns() +
			'return fn;';

		var fn = (new Function('$filter',
				'ensureSafeMemberName',
				'ensureSafeObject',
				'ensureSafeFunction',
				'getStringValue',
				'ensureSafeAssignContext',
				'ifDefined',
				'plus',
				'text',
				fnString))(
					this.$filter,
					ensureSafeMemberName,
					ensureSafeObject,
					ensureSafeFunction,
					getStringValue,
					ensureSafeAssignContext,
					ifDefined,
					plusFn,
					expression);

		this.state = this.stage = undefined;
		fn.literal = isLiteral(ast);
		fn.constant = isConstant(ast);
		return fn;
	},

	USE: 'use',

	STRICT: 'strict',

	watchFns: function() {
		var result = [];
		var fns = this.state.inputs;
		var self = this;
		forEach(fns, function(name) {
			result.push('var ' + name + '=' + self.generateFunction(name, 's'));
		});
		if (fns.length) {
			result.push('fn.inputs=[' + fns.join(',') + '];');
		}
		return result.join('');
	},

	generateFunction: function(name, params) {
		return 'function(' + params + '){' +
				this.varsPrefix(name) +
				this.body(name) +
				'};';
	},

	filterPrefix: function() {
		var parts = [];
		var self = this;
		forEach(this.state.filters, function(id, filter) {
			parts.push(id + '=$filter(' + self.escape(filter) + ')');
		});
		if (parts.length) return 'var ' + parts.join(',') + ';';
		return '';
	},

	varsPrefix: function(section) {
		return this.state[section].vars.length ? 'var ' + this.state[section].vars.join(',') + ';' : '';
	},

	body: function(section) {
		return this.state[section].body.join('');
	},

	recurse: function(ast, intoId, nameId, recursionFn, create, skipWatchIdCheck) {
		var left, right, self = this, args, expression, computed;
		recursionFn = recursionFn || noop;
		if (!skipWatchIdCheck && isDefined(ast.watchId)) {
			intoId = intoId || this.nextId();
			this.if_('i',
				this.lazyAssign(intoId, this.computedMember('i', ast.watchId)),
				this.lazyRecurse(ast, intoId, nameId, recursionFn, create, true)
			);
			return;
		}
		switch (ast.type) {
		case AST.Program:
			forEach(ast.body, function(expression, pos) {
				self.recurse(expression.expression, undefined, undefined, function(expr) { right = expr; });
				if (pos !== ast.body.length - 1) {
					self.current().body.push(right, ';');
				} else {
					self.return_(right);
				}
			});
			break;
		case AST.Literal:
			expression = this.escape(ast.value);
			this.assign(intoId, expression);
			recursionFn(expression);
			break;
		case AST.UnaryExpression:
			this.recurse(ast.argument, undefined, undefined, function(expr) { right = expr; });
			expression = ast.operator + '(' + this.ifDefined(right, 0) + ')';
			this.assign(intoId, expression);
			recursionFn(expression);
			break;
		case AST.BinaryExpression:
			this.recurse(ast.left, undefined, undefined, function(expr) { left = expr; });
			this.recurse(ast.right, undefined, undefined, function(expr) { right = expr; });
			if (ast.operator === '+') {
				expression = this.plus(left, right);
			} else if (ast.operator === '-') {
				expression = this.ifDefined(left, 0) + ast.operator + this.ifDefined(right, 0);
			} else {
				expression = '(' + left + ')' + ast.operator + '(' + right + ')';
			}
			this.assign(intoId, expression);
			recursionFn(expression);
			break;
		case AST.LogicalExpression:
			intoId = intoId || this.nextId();
			self.recurse(ast.left, intoId);
			self.if_(ast.operator === '&&' ? intoId : self.not(intoId), self.lazyRecurse(ast.right, intoId));
			recursionFn(intoId);
			break;
		case AST.ConditionalExpression:
			intoId = intoId || this.nextId();
			self.recurse(ast.test, intoId);
			self.if_(intoId, self.lazyRecurse(ast.alternate, intoId), self.lazyRecurse(ast.consequent, intoId));
			recursionFn(intoId);
			break;
		case AST.Identifier:
			intoId = intoId || this.nextId();
			if (nameId) {
				nameId.context = self.stage === 'inputs' ? 's' : this.assign(this.nextId(), this.getHasOwnProperty('l', ast.name) + '?l:s');
				nameId.computed = false;
				nameId.name = ast.name;
			}
			ensureSafeMemberName(ast.name);
			self.if_(self.stage === 'inputs' || self.not(self.getHasOwnProperty('l', ast.name)),
				function() {
					self.if_(self.stage === 'inputs' || 's', function() {
						if (create && create !== 1) {
							self.if_(
								self.not(self.nonComputedMember('s', ast.name)),
								self.lazyAssign(self.nonComputedMember('s', ast.name), '{}'));
						}
						self.assign(intoId, self.nonComputedMember('s', ast.name));
					});
				}, intoId && self.lazyAssign(intoId, self.nonComputedMember('l', ast.name))
				);
			if (self.state.expensiveChecks || isPossiblyDangerousMemberName(ast.name)) {
				self.addEnsureSafeObject(intoId);
			}
			recursionFn(intoId);
			break;
		case AST.MemberExpression:
			left = nameId && (nameId.context = this.nextId()) || this.nextId();
			intoId = intoId || this.nextId();
			self.recurse(ast.object, left, undefined, function() {
				self.if_(self.notNull(left), function() {
					if (create && create !== 1) {
						self.addEnsureSafeAssignContext(left);
					}
					if (ast.computed) {
						right = self.nextId();
						self.recurse(ast.property, right);
						self.getStringValue(right);
						self.addEnsureSafeMemberName(right);
						if (create && create !== 1) {
							self.if_(self.not(self.computedMember(left, right)), self.lazyAssign(self.computedMember(left, right), '{}'));
						}
						expression = self.ensureSafeObject(self.computedMember(left, right));
						self.assign(intoId, expression);
						if (nameId) {
							nameId.computed = true;
							nameId.name = right;
						}
					} else {
						ensureSafeMemberName(ast.property.name);
						if (create && create !== 1) {
							self.if_(self.not(self.nonComputedMember(left, ast.property.name)), self.lazyAssign(self.nonComputedMember(left, ast.property.name), '{}'));
						}
						expression = self.nonComputedMember(left, ast.property.name);
						if (self.state.expensiveChecks || isPossiblyDangerousMemberName(ast.property.name)) {
							expression = self.ensureSafeObject(expression);
						}
						self.assign(intoId, expression);
						if (nameId) {
							nameId.computed = false;
							nameId.name = ast.property.name;
						}
					}
				}, function() {
					self.assign(intoId, 'undefined');
				});
				recursionFn(intoId);
			}, !!create);
			break;
		case AST.CallExpression:
			intoId = intoId || this.nextId();
			if (ast.filter) {
				right = self.filter(ast.callee.name);
				args = [];
				forEach(ast.arguments, function(expr) {
					var argument = self.nextId();
					self.recurse(expr, argument);
					args.push(argument);
				});
				expression = right + '(' + args.join(',') + ')';
				self.assign(intoId, expression);
				recursionFn(intoId);
			} else {
				right = self.nextId();
				left = {};
				args = [];
				self.recurse(ast.callee, right, left, function() {
					self.if_(self.notNull(right), function() {
						self.addEnsureSafeFunction(right);
						forEach(ast.arguments, function(expr) {
							self.recurse(expr, self.nextId(), undefined, function(argument) {
								args.push(self.ensureSafeObject(argument));
							});
						});
						if (left.name) {
							if (!self.state.expensiveChecks) {
								self.addEnsureSafeObject(left.context);
							}
							expression = self.member(left.context, left.name, left.computed) + '(' + args.join(',') + ')';
						} else {
							expression = right + '(' + args.join(',') + ')';
						}
						expression = self.ensureSafeObject(expression);
						self.assign(intoId, expression);
					}, function() {
						self.assign(intoId, 'undefined');
					});
					recursionFn(intoId);
				});
			}
			break;
		case AST.AssignmentExpression:
			right = this.nextId();
			left = {};
			if (!isAssignable(ast.left)) {
				throw $parseMinErr('lval', 'Trying to assign a value to a non l-value');
			}
			this.recurse(ast.left, undefined, left, function() {
				self.if_(self.notNull(left.context), function() {
					self.recurse(ast.right, right);
					self.addEnsureSafeObject(self.member(left.context, left.name, left.computed));
					self.addEnsureSafeAssignContext(left.context);
					expression = self.member(left.context, left.name, left.computed) + ast.operator + right;
					self.assign(intoId, expression);
					recursionFn(intoId || expression);
				});
			}, 1);
			break;
		case AST.ArrayExpression:
			args = [];
			forEach(ast.elements, function(expr) {
				self.recurse(expr, self.nextId(), undefined, function(argument) {
					args.push(argument);
				});
			});
			expression = '[' + args.join(',') + ']';
			this.assign(intoId, expression);
			recursionFn(expression);
			break;
		case AST.ObjectExpression:
			args = [];
			computed = false;
			forEach(ast.properties, function(property) {
				if (property.computed) {
					computed = true;
				}
			});
			if (computed) {
				intoId = intoId || this.nextId();
				this.assign(intoId, '{}');
				forEach(ast.properties, function(property) {
					if (property.computed) {
						left = self.nextId();
						self.recurse(property.key, left);
					} else {
						left = property.key.type === AST.Identifier ?
											 property.key.name :
											 ('' + property.key.value);
					}
					right = self.nextId();
					self.recurse(property.value, right);
					self.assign(self.member(intoId, left, property.computed), right);
				});
			} else {
				forEach(ast.properties, function(property) {
					self.recurse(property.value, ast.constant ? undefined : self.nextId(), undefined, function(expr) {
						args.push(self.escape(
								property.key.type === AST.Identifier ? property.key.name :
									('' + property.key.value)) +
								':' + expr);
					});
				});
				expression = '{' + args.join(',') + '}';
				this.assign(intoId, expression);
			}
			recursionFn(intoId || expression);
			break;
		case AST.ThisExpression:
			this.assign(intoId, 's');
			recursionFn('s');
			break;
		case AST.LocalsExpression:
			this.assign(intoId, 'l');
			recursionFn('l');
			break;
		case AST.NGValueParameter:
			this.assign(intoId, 'v');
			recursionFn('v');
			break;
		}
	},

	getHasOwnProperty: function(element, property) {
		var key = element + '.' + property;
		var own = this.current().own;
		if (!own.hasOwnProperty(key)) {
			own[key] = this.nextId(false, element + '&&(' + this.escape(property) + ' in ' + element + ')');
		}
		return own[key];
	},

	assign: function(id, value) {
		if (!id) return;
		this.current().body.push(id, '=', value, ';');
		return id;
	},

	filter: function(filterName) {
		if (!this.state.filters.hasOwnProperty(filterName)) {
			this.state.filters[filterName] = this.nextId(true);
		}
		return this.state.filters[filterName];
	},

	ifDefined: function(id, defaultValue) {
		return 'ifDefined(' + id + ',' + this.escape(defaultValue) + ')';
	},

	plus: function(left, right) {
		return 'plus(' + left + ',' + right + ')';
	},

	return_: function(id) {
		this.current().body.push('return ', id, ';');
	},

	if_: function(test, alternate, consequent) {
		if (test === true) {
			alternate();
		} else {
			var body = this.current().body;
			body.push('if(', test, '){');
			alternate();
			body.push('}');
			if (consequent) {
				body.push('else{');
				consequent();
				body.push('}');
			}
		}
	},

	not: function(expression) {
		return '!(' + expression + ')';
	},

	notNull: function(expression) {
		return expression + '!=null';
	},

	nonComputedMember: function(left, right) {
		var SAFE_IDENTIFIER = /[$_a-zA-Z][$_a-zA-Z0-9]*/;
		var UNSAFE_CHARACTERS = /[^$_a-zA-Z0-9]/g;
		if (SAFE_IDENTIFIER.test(right)) {
			return left + '.' + right;
		} else {
			return left  + '["' + right.replace(UNSAFE_CHARACTERS, this.stringEscapeFn) + '"]';
		}
	},

	computedMember: function(left, right) {
		return left + '[' + right + ']';
	},

	member: function(left, right, computed) {
		if (computed) return this.computedMember(left, right);
		return this.nonComputedMember(left, right);
	},

	addEnsureSafeObject: function(item) {
		this.current().body.push(this.ensureSafeObject(item), ';');
	},

	addEnsureSafeMemberName: function(item) {
		this.current().body.push(this.ensureSafeMemberName(item), ';');
	},

	addEnsureSafeFunction: function(item) {
		this.current().body.push(this.ensureSafeFunction(item), ';');
	},

	addEnsureSafeAssignContext: function(item) {
		this.current().body.push(this.ensureSafeAssignContext(item), ';');
	},

	ensureSafeObject: function(item) {
		return 'ensureSafeObject(' + item + ',text)';
	},

	ensureSafeMemberName: function(item) {
		return 'ensureSafeMemberName(' + item + ',text)';
	},

	ensureSafeFunction: function(item) {
		return 'ensureSafeFunction(' + item + ',text)';
	},

	getStringValue: function(item) {
		this.assign(item, 'getStringValue(' + item + ')');
	},

	ensureSafeAssignContext: function(item) {
		return 'ensureSafeAssignContext(' + item + ',text)';
	},

	lazyRecurse: function(ast, intoId, nameId, recursionFn, create, skipWatchIdCheck) {
		var self = this;
		return function() {
			self.recurse(ast, intoId, nameId, recursionFn, create, skipWatchIdCheck);
		};
	},

	lazyAssign: function(id, value) {
		var self = this;
		return function() {
			self.assign(id, value);
		};
	},

	stringEscapeRegex: /[^ a-zA-Z0-9]/g,

	stringEscapeFn: function(c) {
		return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
	},

	escape: function(value) {
		if (isString(value)) return "'" + value.replace(this.stringEscapeRegex, this.stringEscapeFn) + "'";
		if (isNumber(value)) return value.toString();
		if (value === true) return 'true';
		if (value === false) return 'false';
		if (value === null) return 'null';
		if (typeof value === 'undefined') return 'undefined';

		throw $parseMinErr('esc', 'IMPOSSIBLE');
	},

	nextId: function(skip, init) {
		var id = 'v' + (this.state.nextId++);
		if (!skip) {
			this.current().vars.push(id + (init ? '=' + init : ''));
		}
		return id;
	},

	current: function() {
		return this.state[this.state.computing];
	}
};

function ASTInterpreter(astBuilder, $filter) {
	this.astBuilder = astBuilder;
	this.$filter = $filter;
}

ASTInterpreter.prototype = {
	compile: function(expression, expensiveChecks) {
		var self = this;
		var ast = this.astBuilder.ast(expression);
		this.expression = expression;
		this.expensiveChecks = expensiveChecks;
		findConstantAndWatchExpressions(ast, self.$filter);
		var assignable;
		var assign;
		if ((assignable = assignableAST(ast))) {
			assign = this.recurse(assignable);
		}
		var toWatch = getInputs(ast.body);
		var inputs;
		if (toWatch) {
			inputs = [];
			forEach(toWatch, function(watch, key) {
				var input = self.recurse(watch);
				watch.input = input;
				inputs.push(input);
				watch.watchId = key;
			});
		}
		var expressions = [];
		forEach(ast.body, function(expression) {
			expressions.push(self.recurse(expression.expression));
		});
		var fn = ast.body.length === 0 ? noop :
						 ast.body.length === 1 ? expressions[0] :
						 function(scope, locals) {
							 var lastValue;
							 forEach(expressions, function(exp) {
								 lastValue = exp(scope, locals);
							 });
							 return lastValue;
						 };
		if (assign) {
			fn.assign = function(scope, value, locals) {
				return assign(scope, locals, value);
			};
		}
		if (inputs) {
			fn.inputs = inputs;
		}
		fn.literal = isLiteral(ast);
		fn.constant = isConstant(ast);
		return fn;
	},

	recurse: function(ast, context, create) {
		var left, right, self = this, args, expression;
		if (ast.input) {
			return this.inputs(ast.input, ast.watchId);
		}
		switch (ast.type) {
		case AST.Literal:
			return this.value(ast.value, context);
		case AST.UnaryExpression:
			right = this.recurse(ast.argument);
			return this['unary' + ast.operator](right, context);
		case AST.BinaryExpression:
			left = this.recurse(ast.left);
			right = this.recurse(ast.right);
			return this['binary' + ast.operator](left, right, context);
		case AST.LogicalExpression:
			left = this.recurse(ast.left);
			right = this.recurse(ast.right);
			return this['binary' + ast.operator](left, right, context);
		case AST.ConditionalExpression:
			return this['ternary?:'](
				this.recurse(ast.test),
				this.recurse(ast.alternate),
				this.recurse(ast.consequent),
				context
			);
		case AST.Identifier:
			ensureSafeMemberName(ast.name, self.expression);
			return self.identifier(ast.name,
														 self.expensiveChecks || isPossiblyDangerousMemberName(ast.name),
														 context, create, self.expression);
		case AST.MemberExpression:
			left = this.recurse(ast.object, false, !!create);
			if (!ast.computed) {
				ensureSafeMemberName(ast.property.name, self.expression);
				right = ast.property.name;
			}
			if (ast.computed) right = this.recurse(ast.property);
			return ast.computed ?
				this.computedMember(left, right, context, create, self.expression) :
				this.nonComputedMember(left, right, self.expensiveChecks, context, create, self.expression);
		case AST.CallExpression:
			args = [];
			forEach(ast.arguments, function(expr) {
				args.push(self.recurse(expr));
			});
			if (ast.filter) right = this.$filter(ast.callee.name);
			if (!ast.filter) right = this.recurse(ast.callee, true);
			return ast.filter ?
				function(scope, locals, assign, inputs) {
					var values = [];
					for (var i = 0; i < args.length; ++i) {
						values.push(args[i](scope, locals, assign, inputs));
					}
					var value = right.apply(undefined, values, inputs);
					return context ? {context: undefined, name: undefined, value: value} : value;
				} :
				function(scope, locals, assign, inputs) {
					var rhs = right(scope, locals, assign, inputs);
					var value;
					if (rhs.value != null) {
						ensureSafeObject(rhs.context, self.expression);
						ensureSafeFunction(rhs.value, self.expression);
						var values = [];
						for (var i = 0; i < args.length; ++i) {
							values.push(ensureSafeObject(args[i](scope, locals, assign, inputs), self.expression));
						}
						value = ensureSafeObject(rhs.value.apply(rhs.context, values), self.expression);
					}
					return context ? {value: value} : value;
				};
		case AST.AssignmentExpression:
			left = this.recurse(ast.left, true, 1);
			right = this.recurse(ast.right);
			return function(scope, locals, assign, inputs) {
				var lhs = left(scope, locals, assign, inputs);
				var rhs = right(scope, locals, assign, inputs);
				ensureSafeObject(lhs.value, self.expression);
				ensureSafeAssignContext(lhs.context);
				lhs.context[lhs.name] = rhs;
				return context ? {value: rhs} : rhs;
			};
		case AST.ArrayExpression:
			args = [];
			forEach(ast.elements, function(expr) {
				args.push(self.recurse(expr));
			});
			return function(scope, locals, assign, inputs) {
				var value = [];
				for (var i = 0; i < args.length; ++i) {
					value.push(args[i](scope, locals, assign, inputs));
				}
				return context ? {value: value} : value;
			};
		case AST.ObjectExpression:
			args = [];
			forEach(ast.properties, function(property) {
				if (property.computed) {
					args.push({key: self.recurse(property.key),
										 computed: true,
										 value: self.recurse(property.value)
					});
				} else {
					args.push({key: property.key.type === AST.Identifier ?
													property.key.name :
													('' + property.key.value),
										 computed: false,
										 value: self.recurse(property.value)
					});
				}
			});
			return function(scope, locals, assign, inputs) {
				var value = {};
				for (var i = 0; i < args.length; ++i) {
					if (args[i].computed) {
						value[args[i].key(scope, locals, assign, inputs)] = args[i].value(scope, locals, assign, inputs);
					} else {
						value[args[i].key] = args[i].value(scope, locals, assign, inputs);
					}
				}
				return context ? {value: value} : value;
			};
		case AST.ThisExpression:
			return function(scope) {
				return context ? {value: scope} : scope;
			};
		case AST.LocalsExpression:
			return function(scope, locals) {
				return context ? {value: locals} : locals;
			};
		case AST.NGValueParameter:
			return function(scope, locals, assign) {
				return context ? {value: assign} : assign;
			};
		}
	},

	'unary+': function(argument, context) {
		return function(scope, locals, assign, inputs) {
			var arg = argument(scope, locals, assign, inputs);
			if (isDefined(arg)) {
				arg = +arg;
			} else {
				arg = 0;
			}
			return context ? {value: arg} : arg;
		};
	},
	'unary-': function(argument, context) {
		return function(scope, locals, assign, inputs) {
			var arg = argument(scope, locals, assign, inputs);
			if (isDefined(arg)) {
				arg = -arg;
			} else {
				arg = 0;
			}
			return context ? {value: arg} : arg;
		};
	},
	'unary!': function(argument, context) {
		return function(scope, locals, assign, inputs) {
			var arg = !argument(scope, locals, assign, inputs);
			return context ? {value: arg} : arg;
		};
	},
	'binary+': function(left, right, context) {
		return function(scope, locals, assign, inputs) {
			var lhs = left(scope, locals, assign, inputs);
			var rhs = right(scope, locals, assign, inputs);
			var arg = plusFn(lhs, rhs);
			return context ? {value: arg} : arg;
		};
	},
	'binary-': function(left, right, context) {
		return function(scope, locals, assign, inputs) {
			var lhs = left(scope, locals, assign, inputs);
			var rhs = right(scope, locals, assign, inputs);
			var arg = (isDefined(lhs) ? lhs : 0) - (isDefined(rhs) ? rhs : 0);
			return context ? {value: arg} : arg;
		};
	},
	'binary*': function(left, right, context) {
		return function(scope, locals, assign, inputs) {
			var arg = left(scope, locals, assign, inputs) * right(scope, locals, assign, inputs);
			return context ? {value: arg} : arg;
		};
	},
	'binary/': function(left, right, context) {
		return function(scope, locals, assign, inputs) {
			var arg = left(scope, locals, assign, inputs) / right(scope, locals, assign, inputs);
			return context ? {value: arg} : arg;
		};
	},
	'binary%': function(left, right, context) {
		return function(scope, locals, assign, inputs) {
			var arg = left(scope, locals, assign, inputs) % right(scope, locals, assign, inputs);
			return context ? {value: arg} : arg;
		};
	},
	'binary===': function(left, right, context) {
		return function(scope, locals, assign, inputs) {
			var arg = left(scope, locals, assign, inputs) === right(scope, locals, assign, inputs);
			return context ? {value: arg} : arg;
		};
	},
	'binary!==': function(left, right, context) {
		return function(scope, locals, assign, inputs) {
			var arg = left(scope, locals, assign, inputs) !== right(scope, locals, assign, inputs);
			return context ? {value: arg} : arg;
		};
	},
	'binary==': function(left, right, context) {
		return function(scope, locals, assign, inputs) {
			var arg = left(scope, locals, assign, inputs) == right(scope, locals, assign, inputs);
			return context ? {value: arg} : arg;
		};
	},
	'binary!=': function(left, right, context) {
		return function(scope, locals, assign, inputs) {
			var arg = left(scope, locals, assign, inputs) != right(scope, locals, assign, inputs);
			return context ? {value: arg} : arg;
		};
	},
	'binary<': function(left, right, context) {
		return function(scope, locals, assign, inputs) {
			var arg = left(scope, locals, assign, inputs) < right(scope, locals, assign, inputs);
			return context ? {value: arg} : arg;
		};
	},
	'binary>': function(left, right, context) {
		return function(scope, locals, assign, inputs) {
			var arg = left(scope, locals, assign, inputs) > right(scope, locals, assign, inputs);
			return context ? {value: arg} : arg;
		};
	},
	'binary<=': function(left, right, context) {
		return function(scope, locals, assign, inputs) {
			var arg = left(scope, locals, assign, inputs) <= right(scope, locals, assign, inputs);
			return context ? {value: arg} : arg;
		};
	},
	'binary>=': function(left, right, context) {
		return function(scope, locals, assign, inputs) {
			var arg = left(scope, locals, assign, inputs) >= right(scope, locals, assign, inputs);
			return context ? {value: arg} : arg;
		};
	},
	'binary&&': function(left, right, context) {
		return function(scope, locals, assign, inputs) {
			var arg = left(scope, locals, assign, inputs) && right(scope, locals, assign, inputs);
			return context ? {value: arg} : arg;
		};
	},
	'binary||': function(left, right, context) {
		return function(scope, locals, assign, inputs) {
			var arg = left(scope, locals, assign, inputs) || right(scope, locals, assign, inputs);
			return context ? {value: arg} : arg;
		};
	},
	'ternary?:': function(test, alternate, consequent, context) {
		return function(scope, locals, assign, inputs) {
			var arg = test(scope, locals, assign, inputs) ? alternate(scope, locals, assign, inputs) : consequent(scope, locals, assign, inputs);
			return context ? {value: arg} : arg;
		};
	},
	value: function(value, context) {
		return function() { return context ? {context: undefined, name: undefined, value: value} : value; };
	},
	identifier: function(name, expensiveChecks, context, create, expression) {
		return function(scope, locals, assign, inputs) {
			var base = locals && (name in locals) ? locals : scope;
			if (create && create !== 1 && base && !(base[name])) {
				base[name] = {};
			}
			var value = base ? base[name] : undefined;
			if (expensiveChecks) {
				ensureSafeObject(value, expression);
			}
			if (context) {
				return {context: base, name: name, value: value};
			} else {
				return value;
			}
		};
	},
	computedMember: function(left, right, context, create, expression) {
		return function(scope, locals, assign, inputs) {
			var lhs = left(scope, locals, assign, inputs);
			var rhs;
			var value;
			if (lhs != null) {
				rhs = right(scope, locals, assign, inputs);
				rhs = getStringValue(rhs);
				ensureSafeMemberName(rhs, expression);
				if (create && create !== 1) {
					ensureSafeAssignContext(lhs);
					if (lhs && !(lhs[rhs])) {
						lhs[rhs] = {};
					}
				}
				value = lhs[rhs];
				ensureSafeObject(value, expression);
			}
			if (context) {
				return {context: lhs, name: rhs, value: value};
			} else {
				return value;
			}
		};
	},
	nonComputedMember: function(left, right, expensiveChecks, context, create, expression) {
		return function(scope, locals, assign, inputs) {
			var lhs = left(scope, locals, assign, inputs);
			if (create && create !== 1) {
				ensureSafeAssignContext(lhs);
				if (lhs && !(lhs[right])) {
					lhs[right] = {};
				}
			}
			var value = lhs != null ? lhs[right] : undefined;
			if (expensiveChecks || isPossiblyDangerousMemberName(right)) {
				ensureSafeObject(value, expression);
			}
			if (context) {
				return {context: lhs, name: right, value: value};
			} else {
				return value;
			}
		};
	},
	inputs: function(input, watchId) {
		return function(scope, value, locals, inputs) {
			if (inputs) return inputs[watchId];
			return input(scope, value, locals);
		};
	}
};

var Parser = function(lexer, $filter, options) {
	this.lexer = lexer;
	this.$filter = $filter;
	this.options = options;
	this.ast = new AST(lexer, options);
	this.astCompiler = options.csp ? new ASTInterpreter(this.ast, $filter) :
																	 new ASTCompiler(this.ast, $filter);
};

Parser.prototype = {
	constructor: Parser,

	parse: function(text) {
		return this.astCompiler.compile(text, this.options.expensiveChecks);
	}
};

function isPossiblyDangerousMemberName(name) {
	return name == 'constructor';
}

var objectValueOf = Object.prototype.valueOf;

function getValueOf(value) {
	return isFunction(value.valueOf) ? value.valueOf() : objectValueOf.call(value);
}

///////////////////////////////////

function $ParseProvider() {
	var cacheDefault = createMap();
	var cacheExpensive = createMap();
	var literals = {
		'true': true,
		'false': false,
		'null': null,
		'undefined': undefined
	};
	var identStart, identContinue;

	this.addLiteral = function(literalName, literalValue) {
		literals[literalName] = literalValue;
	};

	this.setIdentifierFns = function(identifierStart, identifierContinue) {
		identStart = identifierStart;
		identContinue = identifierContinue;
		return this;
	};

	this.$get = ['$filter', function($filter) {
		var noUnsafeEval = csp().noUnsafeEval;
		var $parseOptions = {
					csp: noUnsafeEval,
					expensiveChecks: false,
					literals: copy(literals),
					isIdentifierStart: isFunction(identStart) && identStart,
					isIdentifierContinue: isFunction(identContinue) && identContinue
				},
				$parseOptionsExpensive = {
					csp: noUnsafeEval,
					expensiveChecks: true,
					literals: copy(literals),
					isIdentifierStart: isFunction(identStart) && identStart,
					isIdentifierContinue: isFunction(identContinue) && identContinue
				};
		var runningChecksEnabled = false;

		$parse.$$runningExpensiveChecks = function() {
			return runningChecksEnabled;
		};

		return $parse;

		function $parse(exp, interceptorFn, expensiveChecks) {
			var parsedExpression, oneTime, cacheKey;

			expensiveChecks = expensiveChecks || runningChecksEnabled;

			switch (typeof exp) {
				case 'string':
					exp = exp.trim();
					cacheKey = exp;

					var cache = (expensiveChecks ? cacheExpensive : cacheDefault);
					parsedExpression = cache[cacheKey];

					if (!parsedExpression) {
						if (exp.charAt(0) === ':' && exp.charAt(1) === ':') {
							oneTime = true;
							exp = exp.substring(2);
						}
						var parseOptions = expensiveChecks ? $parseOptionsExpensive : $parseOptions;
						var lexer = new Lexer(parseOptions);
						var parser = new Parser(lexer, $filter, parseOptions);
						parsedExpression = parser.parse(exp);
						if (parsedExpression.constant) {
							parsedExpression.$$watchDelegate = constantWatchDelegate;
						} else if (oneTime) {
							parsedExpression.$$watchDelegate = parsedExpression.literal ?
									oneTimeLiteralWatchDelegate : oneTimeWatchDelegate;
						} else if (parsedExpression.inputs) {
							parsedExpression.$$watchDelegate = inputsWatchDelegate;
						}
						if (expensiveChecks) {
							parsedExpression = expensiveChecksInterceptor(parsedExpression);
						}
						cache[cacheKey] = parsedExpression;
					}
					return addInterceptor(parsedExpression, interceptorFn);

				case 'function':
					return addInterceptor(exp, interceptorFn);

				default:
					return addInterceptor(noop, interceptorFn);
			}
		}

		function expensiveChecksInterceptor(fn) {
			if (!fn) return fn;
			expensiveCheckFn.$$watchDelegate = fn.$$watchDelegate;
			expensiveCheckFn.assign = expensiveChecksInterceptor(fn.assign);
			expensiveCheckFn.constant = fn.constant;
			expensiveCheckFn.literal = fn.literal;
			for (var i = 0; fn.inputs && i < fn.inputs.length; ++i) {
				fn.inputs[i] = expensiveChecksInterceptor(fn.inputs[i]);
			}
			expensiveCheckFn.inputs = fn.inputs;

			return expensiveCheckFn;

			function expensiveCheckFn(scope, locals, assign, inputs) {
				var expensiveCheckOldValue = runningChecksEnabled;
				runningChecksEnabled = true;
				try {
					return fn(scope, locals, assign, inputs);
				} finally {
					runningChecksEnabled = expensiveCheckOldValue;
				}
			}
		}

		function expressionInputDirtyCheck(newValue, oldValueOfValue) {

			if (newValue == null || oldValueOfValue == null) { // null/undefined
				return newValue === oldValueOfValue;
			}

			if (typeof newValue === 'object') {

				// attempt to convert the value to a primitive type
				// TODO(docs): add a note to docs that by implementing valueOf even objects and arrays can
				//             be cheaply dirty-checked
				newValue = getValueOf(newValue);

				if (typeof newValue === 'object') {
					// objects/arrays are not supported - deep-watching them would be too expensive
					return false;
				}

				// fall-through to the primitive equality check
			}

			//Primitive or NaN
			return newValue === oldValueOfValue || (newValue !== newValue && oldValueOfValue !== oldValueOfValue);
		}

		function inputsWatchDelegate(scope, listener, objectEquality, parsedExpression, prettyPrintExpression) {
			var inputExpressions = parsedExpression.inputs;
			var lastResult;

			if (inputExpressions.length === 1) {
				var oldInputValueOf = expressionInputDirtyCheck; // init to something unique so that equals check fails
				inputExpressions = inputExpressions[0];
				return scope.$watch(function expressionInputWatch(scope) {
					var newInputValue = inputExpressions(scope);
					if (!expressionInputDirtyCheck(newInputValue, oldInputValueOf)) {
						lastResult = parsedExpression(scope, undefined, undefined, [newInputValue]);
						oldInputValueOf = newInputValue && getValueOf(newInputValue);
					}
					return lastResult;
				}, listener, objectEquality, prettyPrintExpression);
			}

			var oldInputValueOfValues = [];
			var oldInputValues = [];
			for (var i = 0, ii = inputExpressions.length; i < ii; i++) {
				oldInputValueOfValues[i] = expressionInputDirtyCheck; // init to something unique so that equals check fails
				oldInputValues[i] = null;
			}

			return scope.$watch(function expressionInputsWatch(scope) {
				var changed = false;

				for (var i = 0, ii = inputExpressions.length; i < ii; i++) {
					var newInputValue = inputExpressions[i](scope);
					if (changed || (changed = !expressionInputDirtyCheck(newInputValue, oldInputValueOfValues[i]))) {
						oldInputValues[i] = newInputValue;
						oldInputValueOfValues[i] = newInputValue && getValueOf(newInputValue);
					}
				}

				if (changed) {
					lastResult = parsedExpression(scope, undefined, undefined, oldInputValues);
				}

				return lastResult;
			}, listener, objectEquality, prettyPrintExpression);
		}

		function oneTimeWatchDelegate(scope, listener, objectEquality, parsedExpression) {
			var unwatch, lastValue;
			return unwatch = scope.$watch(function oneTimeWatch(scope) {
				return parsedExpression(scope);
			}, function oneTimeListener(value, old, scope) {
				lastValue = value;
				if (isFunction(listener)) {
					listener.apply(this, arguments);
				}
				if (isDefined(value)) {
					scope.$$postDigest(function() {
						if (isDefined(lastValue)) {
							unwatch();
						}
					});
				}
			}, objectEquality);
		}

		function oneTimeLiteralWatchDelegate(scope, listener, objectEquality, parsedExpression) {
			var unwatch, lastValue;
			return unwatch = scope.$watch(function oneTimeWatch(scope) {
				return parsedExpression(scope);
			}, function oneTimeListener(value, old, scope) {
				lastValue = value;
				if (isFunction(listener)) {
					listener.call(this, value, old, scope);
				}
				if (isAllDefined(value)) {
					scope.$$postDigest(function() {
						if (isAllDefined(lastValue)) unwatch();
					});
				}
			}, objectEquality);

			function isAllDefined(value) {
				var allDefined = true;
				forEach(value, function(val) {
					if (!isDefined(val)) allDefined = false;
				});
				return allDefined;
			}
		}

		function constantWatchDelegate(scope, listener, objectEquality, parsedExpression) {
			var unwatch;
			return unwatch = scope.$watch(function constantWatch(scope) {
				unwatch();
				return parsedExpression(scope);
			}, listener, objectEquality);
		}

		function addInterceptor(parsedExpression, interceptorFn) {
			if (!interceptorFn) return parsedExpression;
			var watchDelegate = parsedExpression.$$watchDelegate;
			var useInputs = false;

			var regularWatch =
					watchDelegate !== oneTimeLiteralWatchDelegate &&
					watchDelegate !== oneTimeWatchDelegate;

			var fn = regularWatch ? function regularInterceptedExpression(scope, locals, assign, inputs) {
				var value = useInputs && inputs ? inputs[0] : parsedExpression(scope, locals, assign, inputs);
				return interceptorFn(value, scope, locals);
			} : function oneTimeInterceptedExpression(scope, locals, assign, inputs) {
				var value = parsedExpression(scope, locals, assign, inputs);
				var result = interceptorFn(value, scope, locals);
				// we only return the interceptor's result if the
				// initial value is defined (for bind-once)
				return isDefined(value) ? result : value;
			};

			// Propagate $$watchDelegates other then inputsWatchDelegate
			if (parsedExpression.$$watchDelegate &&
					parsedExpression.$$watchDelegate !== inputsWatchDelegate) {
				fn.$$watchDelegate = parsedExpression.$$watchDelegate;
			} else if (!interceptorFn.$stateful) {
				// If there is an interceptor, but no watchDelegate then treat the interceptor like
				// we treat filters - it is assumed to be a pure function unless flagged with $stateful
				fn.$$watchDelegate = inputsWatchDelegate;
				useInputs = !parsedExpression.inputs;
				fn.inputs = parsedExpression.inputs ? parsedExpression.inputs : [parsedExpression];
			}

			return fn;
		}
	}];
}

function $QProvider() {

	this.$get = ['$rootScope', '$exceptionHandler', function($rootScope, $exceptionHandler) {
		return qFactory(function(callback) {
			$rootScope.$evalAsync(callback);
		}, $exceptionHandler);
	}];
}

function $$QProvider() {
	this.$get = ['$browser', '$exceptionHandler', function($browser, $exceptionHandler) {
		return qFactory(function(callback) {
			$browser.defer(callback);
		}, $exceptionHandler);
	}];
}

function qFactory(nextTick, exceptionHandler) {
	var $qMinErr = minErr('$q', TypeError);

	var defer = function() {
		var d = new Deferred();
		//Necessary to support unbound execution :/
		d.resolve = simpleBind(d, d.resolve);
		d.reject = simpleBind(d, d.reject);
		d.notify = simpleBind(d, d.notify);
		return d;
	};

	function Promise() {
		this.$$state = { status: 0 };
	}

	extend(Promise.prototype, {
		then: function(onFulfilled, onRejected, progressBack) {
			if (isUndefined(onFulfilled) && isUndefined(onRejected) && isUndefined(progressBack)) {
				return this;
			}
			var result = new Deferred();

			this.$$state.pending = this.$$state.pending || [];
			this.$$state.pending.push([result, onFulfilled, onRejected, progressBack]);
			if (this.$$state.status > 0) scheduleProcessQueue(this.$$state);

			return result.promise;
		},

		"catch": function(callback) {
			return this.then(null, callback);
		},

		"finally": function(callback, progressBack) {
			return this.then(function(value) {
				return handleCallback(value, true, callback);
			}, function(error) {
				return handleCallback(error, false, callback);
			}, progressBack);
		}
	});

	//Faster, more basic than angular.bind http://jsperf.com/angular-bind-vs-custom-vs-native
	function simpleBind(context, fn) {
		return function(value) {
			fn.call(context, value);
		};
	}

	function processQueue(state) {
		var fn, deferred, pending;

		pending = state.pending;
		state.processScheduled = false;
		state.pending = undefined;
		for (var i = 0, ii = pending.length; i < ii; ++i) {
			deferred = pending[i][0];
			fn = pending[i][state.status];
			try {
				if (isFunction(fn)) {
					deferred.resolve(fn(state.value));
				} else if (state.status === 1) {
					deferred.resolve(state.value);
				} else {
					deferred.reject(state.value);
				}
			} catch (e) {
				deferred.reject(e);
				exceptionHandler(e);
			}
		}
	}

	function scheduleProcessQueue(state) {
		if (state.processScheduled || !state.pending) return;
		state.processScheduled = true;
		nextTick(function() { processQueue(state); });
	}

	function Deferred() {
		this.promise = new Promise();
	}

	extend(Deferred.prototype, {
		resolve: function(val) {
			if (this.promise.$$state.status) return;
			if (val === this.promise) {
				this.$$reject($qMinErr(
					'qcycle',
					"Expected promise to be resolved with value other than itself '{0}'",
					val));
			} else {
				this.$$resolve(val);
			}

		},

		$$resolve: function(val) {
			var then;
			var that = this;
			var done = false;
			try {
				if ((isObject(val) || isFunction(val))) then = val && val.then;
				if (isFunction(then)) {
					this.promise.$$state.status = -1;
					then.call(val, resolvePromise, rejectPromise, simpleBind(this, this.notify));
				} else {
					this.promise.$$state.value = val;
					this.promise.$$state.status = 1;
					scheduleProcessQueue(this.promise.$$state);
				}
			} catch (e) {
				rejectPromise(e);
				exceptionHandler(e);
			}

			function resolvePromise(val) {
				if (done) return;
				done = true;
				that.$$resolve(val);
			}
			function rejectPromise(val) {
				if (done) return;
				done = true;
				that.$$reject(val);
			}
		},

		reject: function(reason) {
			if (this.promise.$$state.status) return;
			this.$$reject(reason);
		},

		$$reject: function(reason) {
			this.promise.$$state.value = reason;
			this.promise.$$state.status = 2;
			scheduleProcessQueue(this.promise.$$state);
		},

		notify: function(progress) {
			var callbacks = this.promise.$$state.pending;

			if ((this.promise.$$state.status <= 0) && callbacks && callbacks.length) {
				nextTick(function() {
					var callback, result;
					for (var i = 0, ii = callbacks.length; i < ii; i++) {
						result = callbacks[i][0];
						callback = callbacks[i][3];
						try {
							result.notify(isFunction(callback) ? callback(progress) : progress);
						} catch (e) {
							exceptionHandler(e);
						}
					}
				});
			}
		}
	});

	var reject = function(reason) {
		var result = new Deferred();
		result.reject(reason);
		return result.promise;
	};

	var makePromise = function makePromise(value, resolved) {
		var result = new Deferred();
		if (resolved) {
			result.resolve(value);
		} else {
			result.reject(value);
		}
		return result.promise;
	};

	var handleCallback = function handleCallback(value, isResolved, callback) {
		var callbackOutput = null;
		try {
			if (isFunction(callback)) callbackOutput = callback();
		} catch (e) {
			return makePromise(e, false);
		}
		if (isPromiseLike(callbackOutput)) {
			return callbackOutput.then(function() {
				return makePromise(value, isResolved);
			}, function(error) {
				return makePromise(error, false);
			});
		} else {
			return makePromise(value, isResolved);
		}
	};

	var when = function(value, callback, errback, progressBack) {
		var result = new Deferred();
		result.resolve(value);
		return result.promise.then(callback, errback, progressBack);
	};

	var resolve = when;

	function all(promises) {
		var deferred = new Deferred(),
				counter = 0,
				results = isArray(promises) ? [] : {};

		forEach(promises, function(promise, key) {
			counter++;
			when(promise).then(function(value) {
				if (results.hasOwnProperty(key)) return;
				results[key] = value;
				if (!(--counter)) deferred.resolve(results);
			}, function(reason) {
				if (results.hasOwnProperty(key)) return;
				deferred.reject(reason);
			});
		});

		if (counter === 0) {
			deferred.resolve(results);
		}

		return deferred.promise;
	}

	var $Q = function Q(resolver) {
		if (!isFunction(resolver)) {
			throw $qMinErr('norslvr', "Expected resolverFn, got '{0}'", resolver);
		}

		var deferred = new Deferred();

		function resolveFn(value) {
			deferred.resolve(value);
		}

		function rejectFn(reason) {
			deferred.reject(reason);
		}

		resolver(resolveFn, rejectFn);

		return deferred.promise;
	};

	// Let's make the instanceof operator work for promises, so that
	// `new $q(fn) instanceof $q` would evaluate to true.
	$Q.prototype = Promise.prototype;

	$Q.defer = defer;
	$Q.reject = reject;
	$Q.when = when;
	$Q.resolve = resolve;
	$Q.all = all;

	return $Q;
}

function $$RAFProvider() { //rAF
	this.$get = ['$window', '$timeout', function($window, $timeout) {
		var requestAnimationFrame = $window.requestAnimationFrame ||
																$window.webkitRequestAnimationFrame;

		var cancelAnimationFrame = $window.cancelAnimationFrame ||
															 $window.webkitCancelAnimationFrame ||
															 $window.webkitCancelRequestAnimationFrame;

		var rafSupported = !!requestAnimationFrame;
		var raf = rafSupported
			? function(fn) {
					var id = requestAnimationFrame(fn);
					return function() {
						cancelAnimationFrame(id);
					};
				}
			: function(fn) {
					var timer = $timeout(fn, 16.66, false); // 1000 / 60 = 16.666
					return function() {
						$timeout.cancel(timer);
					};
				};

		raf.supported = rafSupported;

		return raf;
	}];
}

function $RootScopeProvider() {
	var TTL = 10;
	var $rootScopeMinErr = minErr('$rootScope');
	var lastDirtyWatch = null;
	var applyAsyncId = null;

	this.digestTtl = function(value) {
		if (arguments.length) {
			TTL = value;
		}
		return TTL;
	};

	function createChildScopeClass(parent) {
		function ChildScope() {
			this.$$watchers = this.$$nextSibling =
					this.$$childHead = this.$$childTail = null;
			this.$$listeners = {};
			this.$$listenerCount = {};
			this.$$watchersCount = 0;
			this.$id = nextUid();
			this.$$ChildScope = null;
		}
		ChildScope.prototype = parent;
		return ChildScope;
	}

	this.$get = ['$exceptionHandler', '$parse', '$browser',
			function($exceptionHandler, $parse, $browser) {

		function destroyChildScope($event) {
				$event.currentScope.$$destroyed = true;
		}

		function cleanUpScope($scope) {

			if (msie === 9) {
				// There is a memory leak in IE9 if all child scopes are not disconnected
				// completely when a scope is destroyed. So this code will recurse up through
				// all this scopes children
				//
				// See issue https://github.com/angular/angular.js/issues/10706
				$scope.$$childHead && cleanUpScope($scope.$$childHead);
				$scope.$$nextSibling && cleanUpScope($scope.$$nextSibling);
			}

			// The code below works around IE9 and V8's memory leaks
			//
			// See:
			// - https://code.google.com/p/v8/issues/detail?id=2073#c26
			// - https://github.com/angular/angular.js/issues/6794#issuecomment-38648909
			// - https://github.com/angular/angular.js/issues/1313#issuecomment-10378451

			$scope.$parent = $scope.$$nextSibling = $scope.$$prevSibling = $scope.$$childHead =
					$scope.$$childTail = $scope.$root = $scope.$$watchers = null;
		}

		function Scope() {
			this.$id = nextUid();
			this.$$phase = this.$parent = this.$$watchers =
										 this.$$nextSibling = this.$$prevSibling =
										 this.$$childHead = this.$$childTail = null;
			this.$root = this;
			this.$$destroyed = false;
			this.$$listeners = {};
			this.$$listenerCount = {};
			this.$$watchersCount = 0;
			this.$$isolateBindings = null;
		}

		Scope.prototype = {
			constructor: Scope,

			$new: function(isolate, parent) {
				var child;

				parent = parent || this;

				if (isolate) {
					child = new Scope();
					child.$root = this.$root;
				} else {
					// Only create a child scope class if somebody asks for one,
					// but cache it to allow the VM to optimize lookups.
					if (!this.$$ChildScope) {
						this.$$ChildScope = createChildScopeClass(this);
					}
					child = new this.$$ChildScope();
				}
				child.$parent = parent;
				child.$$prevSibling = parent.$$childTail;
				if (parent.$$childHead) {
					parent.$$childTail.$$nextSibling = child;
					parent.$$childTail = child;
				} else {
					parent.$$childHead = parent.$$childTail = child;
				}

				// When the new scope is not isolated or we inherit from `this`, and
				// the parent scope is destroyed, the property `$$destroyed` is inherited
				// prototypically. In all other cases, this property needs to be set
				// when the parent scope is destroyed.
				// The listener needs to be added after the parent is set
				if (isolate || parent != this) child.$on('$destroy', destroyChildScope);

				return child;
			},

			$watch: function(watchExp, listener, objectEquality, prettyPrintExpression) {
				var get = $parse(watchExp);

				if (get.$$watchDelegate) {
					return get.$$watchDelegate(this, listener, objectEquality, get, watchExp);
				}
				var scope = this,
						array = scope.$$watchers,
						watcher = {
							fn: listener,
							last: initWatchVal,
							get: get,
							exp: prettyPrintExpression || watchExp,
							eq: !!objectEquality
						};

				lastDirtyWatch = null;

				if (!isFunction(listener)) {
					watcher.fn = noop;
				}

				if (!array) {
					array = scope.$$watchers = [];
				}
				// we use unshift since we use a while loop in $digest for speed.
				// the while loop reads in reverse order.
				array.unshift(watcher);
				incrementWatchersCount(this, 1);

				return function deregisterWatch() {
					if (arrayRemove(array, watcher) >= 0) {
						incrementWatchersCount(scope, -1);
					}
					lastDirtyWatch = null;
				};
			},

			$watchGroup: function(watchExpressions, listener) {
				var oldValues = new Array(watchExpressions.length);
				var newValues = new Array(watchExpressions.length);
				var deregisterFns = [];
				var self = this;
				var changeReactionScheduled = false;
				var firstRun = true;

				if (!watchExpressions.length) {
					// No expressions means we call the listener ASAP
					var shouldCall = true;
					self.$evalAsync(function() {
						if (shouldCall) listener(newValues, newValues, self);
					});
					return function deregisterWatchGroup() {
						shouldCall = false;
					};
				}

				if (watchExpressions.length === 1) {
					// Special case size of one
					return this.$watch(watchExpressions[0], function watchGroupAction(value, oldValue, scope) {
						newValues[0] = value;
						oldValues[0] = oldValue;
						listener(newValues, (value === oldValue) ? newValues : oldValues, scope);
					});
				}

				forEach(watchExpressions, function(expr, i) {
					var unwatchFn = self.$watch(expr, function watchGroupSubAction(value, oldValue) {
						newValues[i] = value;
						oldValues[i] = oldValue;
						if (!changeReactionScheduled) {
							changeReactionScheduled = true;
							self.$evalAsync(watchGroupAction);
						}
					});
					deregisterFns.push(unwatchFn);
				});

				function watchGroupAction() {
					changeReactionScheduled = false;

					if (firstRun) {
						firstRun = false;
						listener(newValues, newValues, self);
					} else {
						listener(newValues, oldValues, self);
					}
				}

				return function deregisterWatchGroup() {
					while (deregisterFns.length) {
						deregisterFns.shift()();
					}
				};
			},

			$watchCollection: function(obj, listener) {
				$watchCollectionInterceptor.$stateful = true;

				var self = this;
				// the current value, updated on each dirty-check run
				var newValue;
				// a shallow copy of the newValue from the last dirty-check run,
				// updated to match newValue during dirty-check run
				var oldValue;
				// a shallow copy of the newValue from when the last change happened
				var veryOldValue;
				// only track veryOldValue if the listener is asking for it
				var trackVeryOldValue = (listener.length > 1);
				var changeDetected = 0;
				var changeDetector = $parse(obj, $watchCollectionInterceptor);
				var internalArray = [];
				var internalObject = {};
				var initRun = true;
				var oldLength = 0;

				function $watchCollectionInterceptor(_value) {
					newValue = _value;
					var newLength, key, bothNaN, newItem, oldItem;

					// If the new value is undefined, then return undefined as the watch may be a one-time watch
					if (isUndefined(newValue)) return;

					if (!isObject(newValue)) { // if primitive
						if (oldValue !== newValue) {
							oldValue = newValue;
							changeDetected++;
						}
					} else if (isArrayLike(newValue)) {
						if (oldValue !== internalArray) {
							// we are transitioning from something which was not an array into array.
							oldValue = internalArray;
							oldLength = oldValue.length = 0;
							changeDetected++;
						}

						newLength = newValue.length;

						if (oldLength !== newLength) {
							// if lengths do not match we need to trigger change notification
							changeDetected++;
							oldValue.length = oldLength = newLength;
						}
						// copy the items to oldValue and look for changes.
						for (var i = 0; i < newLength; i++) {
							oldItem = oldValue[i];
							newItem = newValue[i];

							bothNaN = (oldItem !== oldItem) && (newItem !== newItem);
							if (!bothNaN && (oldItem !== newItem)) {
								changeDetected++;
								oldValue[i] = newItem;
							}
						}
					} else {
						if (oldValue !== internalObject) {
							// we are transitioning from something which was not an object into object.
							oldValue = internalObject = {};
							oldLength = 0;
							changeDetected++;
						}
						// copy the items to oldValue and look for changes.
						newLength = 0;
						for (key in newValue) {
							if (hasOwnProperty.call(newValue, key)) {
								newLength++;
								newItem = newValue[key];
								oldItem = oldValue[key];

								if (key in oldValue) {
									bothNaN = (oldItem !== oldItem) && (newItem !== newItem);
									if (!bothNaN && (oldItem !== newItem)) {
										changeDetected++;
										oldValue[key] = newItem;
									}
								} else {
									oldLength++;
									oldValue[key] = newItem;
									changeDetected++;
								}
							}
						}
						if (oldLength > newLength) {
							// we used to have more keys, need to find them and destroy them.
							changeDetected++;
							for (key in oldValue) {
								if (!hasOwnProperty.call(newValue, key)) {
									oldLength--;
									delete oldValue[key];
								}
							}
						}
					}
					return changeDetected;
				}

				function $watchCollectionAction() {
					if (initRun) {
						initRun = false;
						listener(newValue, newValue, self);
					} else {
						listener(newValue, veryOldValue, self);
					}

					// make a copy for the next time a collection is changed
					if (trackVeryOldValue) {
						if (!isObject(newValue)) {
							//primitive
							veryOldValue = newValue;
						} else if (isArrayLike(newValue)) {
							veryOldValue = new Array(newValue.length);
							for (var i = 0; i < newValue.length; i++) {
								veryOldValue[i] = newValue[i];
							}
						} else { // if object
							veryOldValue = {};
							for (var key in newValue) {
								if (hasOwnProperty.call(newValue, key)) {
									veryOldValue[key] = newValue[key];
								}
							}
						}
					}
				}

				return this.$watch(changeDetector, $watchCollectionAction);
			},

			$digest: function() {
				var watch, value, last, fn, get,
						watchers,
						length,
						dirty, ttl = TTL,
						next, current, target = this,
						watchLog = [],
						logIdx, asyncTask;

				beginPhase('$digest');
				// Check for changes to browser url that happened in sync before the call to $digest
				$browser.$$checkUrlChange();

				if (this === $rootScope && applyAsyncId !== null) {
					// If this is the root scope, and $applyAsync has scheduled a deferred $apply(), then
					// cancel the scheduled $apply and flush the queue of expressions to be evaluated.
					$browser.defer.cancel(applyAsyncId);
					flushApplyAsync();
				}

				lastDirtyWatch = null;

				do { // "while dirty" loop
					dirty = false;
					current = target;

					// It's safe for asyncQueuePosition to be a local variable here because this loop can't
					// be reentered recursively. Calling $digest from a function passed to $applyAsync would
					// lead to a '$digest already in progress' error.
					for (var asyncQueuePosition = 0; asyncQueuePosition < asyncQueue.length; asyncQueuePosition++) {
						try {
							asyncTask = asyncQueue[asyncQueuePosition];
							asyncTask.scope.$eval(asyncTask.expression, asyncTask.locals);
						} catch (e) {
							$exceptionHandler(e);
						}
						lastDirtyWatch = null;
					}
					asyncQueue.length = 0;

					traverseScopesLoop:
					do { // "traverse the scopes" loop
						if ((watchers = current.$$watchers)) {
							// process our watches
							length = watchers.length;
							while (length--) {
								try {
									watch = watchers[length];
									// Most common watches are on primitives, in which case we can short
									// circuit it with === operator, only when === fails do we use .equals
									if (watch) {
										get = watch.get;
										if ((value = get(current)) !== (last = watch.last) &&
												!(watch.eq
														? equals(value, last)
														: (typeof value === 'number' && typeof last === 'number'
															 && isNaN(value) && isNaN(last)))) {
											dirty = true;
											lastDirtyWatch = watch;
											watch.last = watch.eq ? copy(value, null) : value;
											fn = watch.fn;
											fn(value, ((last === initWatchVal) ? value : last), current);
											if (ttl < 5) {
												logIdx = 4 - ttl;
												if (!watchLog[logIdx]) watchLog[logIdx] = [];
												watchLog[logIdx].push({
													msg: isFunction(watch.exp) ? 'fn: ' + (watch.exp.name || watch.exp.toString()) : watch.exp,
													newVal: value,
													oldVal: last
												});
											}
										} else if (watch === lastDirtyWatch) {
											// If the most recently dirty watcher is now clean, short circuit since the remaining watchers
											// have already been tested.
											dirty = false;
											break traverseScopesLoop;
										}
									}
								} catch (e) {
									$exceptionHandler(e);
								}
							}
						}

						// Insanity Warning: scope depth-first traversal
						// yes, this code is a bit crazy, but it works and we have tests to prove it!
						// this piece should be kept in sync with the traversal in $broadcast
						if (!(next = ((current.$$watchersCount && current.$$childHead) ||
								(current !== target && current.$$nextSibling)))) {
							while (current !== target && !(next = current.$$nextSibling)) {
								current = current.$parent;
							}
						}
					} while ((current = next));

					// `break traverseScopesLoop;` takes us to here

					if ((dirty || asyncQueue.length) && !(ttl--)) {
						clearPhase();
						throw $rootScopeMinErr('infdig',
								'{0} $digest() iterations reached. Aborting!\n' +
								'Watchers fired in the last 5 iterations: {1}',
								TTL, watchLog);
					}

				} while (dirty || asyncQueue.length);

				clearPhase();

				// postDigestQueuePosition isn't local here because this loop can be reentered recursively.
				while (postDigestQueuePosition < postDigestQueue.length) {
					try {
						postDigestQueue[postDigestQueuePosition++]();
					} catch (e) {
						$exceptionHandler(e);
					}
				}
				postDigestQueue.length = postDigestQueuePosition = 0;
			},

			$destroy: function() {
				// We can't destroy a scope that has been already destroyed.
				if (this.$$destroyed) return;
				var parent = this.$parent;

				this.$broadcast('$destroy');
				this.$$destroyed = true;

				if (this === $rootScope) {
					//Remove handlers attached to window when $rootScope is removed
					$browser.$$applicationDestroyed();
				}

				incrementWatchersCount(this, -this.$$watchersCount);
				for (var eventName in this.$$listenerCount) {
					decrementListenerCount(this, this.$$listenerCount[eventName], eventName);
				}

				// sever all the references to parent scopes (after this cleanup, the current scope should
				// not be retained by any of our references and should be eligible for garbage collection)
				if (parent && parent.$$childHead == this) parent.$$childHead = this.$$nextSibling;
				if (parent && parent.$$childTail == this) parent.$$childTail = this.$$prevSibling;
				if (this.$$prevSibling) this.$$prevSibling.$$nextSibling = this.$$nextSibling;
				if (this.$$nextSibling) this.$$nextSibling.$$prevSibling = this.$$prevSibling;

				// Disable listeners, watchers and apply/digest methods
				this.$destroy = this.$digest = this.$apply = this.$evalAsync = this.$applyAsync = noop;
				this.$on = this.$watch = this.$watchGroup = function() { return noop; };
				this.$$listeners = {};

				// Disconnect the next sibling to prevent `cleanUpScope` destroying those too
				this.$$nextSibling = null;
				cleanUpScope(this);
			},

			$eval: function(expr, locals) {
				return $parse(expr)(this, locals);
			},

			$evalAsync: function(expr, locals) {
				// if we are outside of an $digest loop and this is the first time we are scheduling async
				// task also schedule async auto-flush
				if (!$rootScope.$$phase && !asyncQueue.length) {
					$browser.defer(function() {
						if (asyncQueue.length) {
							$rootScope.$digest();
						}
					});
				}

				asyncQueue.push({scope: this, expression: $parse(expr), locals: locals});
			},

			$$postDigest: function(fn) {
				postDigestQueue.push(fn);
			},

			$apply: function(expr) {
				try {
					beginPhase('$apply');
					try {
						return this.$eval(expr);
					} finally {
						clearPhase();
					}
				} catch (e) {
					$exceptionHandler(e);
				} finally {
					try {
						$rootScope.$digest();
					} catch (e) {
						$exceptionHandler(e);
						throw e;
					}
				}
			},

			$applyAsync: function(expr) {
				var scope = this;
				expr && applyAsyncQueue.push($applyAsyncExpression);
				expr = $parse(expr);
				scheduleApplyAsync();

				function $applyAsyncExpression() {
					scope.$eval(expr);
				}
			},

			$on: function(name, listener) {
				var namedListeners = this.$$listeners[name];
				if (!namedListeners) {
					this.$$listeners[name] = namedListeners = [];
				}
				namedListeners.push(listener);

				var current = this;
				do {
					if (!current.$$listenerCount[name]) {
						current.$$listenerCount[name] = 0;
					}
					current.$$listenerCount[name]++;
				} while ((current = current.$parent));

				var self = this;
				return function() {
					var indexOfListener = namedListeners.indexOf(listener);
					if (indexOfListener !== -1) {
						namedListeners[indexOfListener] = null;
						decrementListenerCount(self, 1, name);
					}
				};
			},

			$emit: function(name, args) {
				var empty = [],
						namedListeners,
						scope = this,
						stopPropagation = false,
						event = {
							name: name,
							targetScope: scope,
							stopPropagation: function() {stopPropagation = true;},
							preventDefault: function() {
								event.defaultPrevented = true;
							},
							defaultPrevented: false
						},
						listenerArgs = concat([event], arguments, 1),
						i, length;

				do {
					namedListeners = scope.$$listeners[name] || empty;
					event.currentScope = scope;
					for (i = 0, length = namedListeners.length; i < length; i++) {

						// if listeners were deregistered, defragment the array
						if (!namedListeners[i]) {
							namedListeners.splice(i, 1);
							i--;
							length--;
							continue;
						}
						try {
							//allow all listeners attached to the current scope to run
							namedListeners[i].apply(null, listenerArgs);
						} catch (e) {
							$exceptionHandler(e);
						}
					}
					//if any listener on the current scope stops propagation, prevent bubbling
					if (stopPropagation) {
						event.currentScope = null;
						return event;
					}
					//traverse upwards
					scope = scope.$parent;
				} while (scope);

				event.currentScope = null;

				return event;
			},

			$broadcast: function(name, args) {
				var target = this,
						current = target,
						next = target,
						event = {
							name: name,
							targetScope: target,
							preventDefault: function() {
								event.defaultPrevented = true;
							},
							defaultPrevented: false
						};

				if (!target.$$listenerCount[name]) return event;

				var listenerArgs = concat([event], arguments, 1),
						listeners, i, length;

				//down while you can, then up and next sibling or up and next sibling until back at root
				while ((current = next)) {
					event.currentScope = current;
					listeners = current.$$listeners[name] || [];
					for (i = 0, length = listeners.length; i < length; i++) {
						// if listeners were deregistered, defragment the array
						if (!listeners[i]) {
							listeners.splice(i, 1);
							i--;
							length--;
							continue;
						}

						try {
							listeners[i].apply(null, listenerArgs);
						} catch (e) {
							$exceptionHandler(e);
						}
					}

					// Insanity Warning: scope depth-first traversal
					// yes, this code is a bit crazy, but it works and we have tests to prove it!
					// this piece should be kept in sync with the traversal in $digest
					// (though it differs due to having the extra check for $$listenerCount)
					if (!(next = ((current.$$listenerCount[name] && current.$$childHead) ||
							(current !== target && current.$$nextSibling)))) {
						while (current !== target && !(next = current.$$nextSibling)) {
							current = current.$parent;
						}
					}
				}

				event.currentScope = null;
				return event;
			}
		};

		var $rootScope = new Scope();

		//The internal queues. Expose them on the $rootScope for debugging/testing purposes.
		var asyncQueue = $rootScope.$$asyncQueue = [];
		var postDigestQueue = $rootScope.$$postDigestQueue = [];
		var applyAsyncQueue = $rootScope.$$applyAsyncQueue = [];

		var postDigestQueuePosition = 0;

		return $rootScope;

		function beginPhase(phase) {
			if ($rootScope.$$phase) {
				throw $rootScopeMinErr('inprog', '{0} already in progress', $rootScope.$$phase);
			}

			$rootScope.$$phase = phase;
		}

		function clearPhase() {
			$rootScope.$$phase = null;
		}

		function incrementWatchersCount(current, count) {
			do {
				current.$$watchersCount += count;
			} while ((current = current.$parent));
		}

		function decrementListenerCount(current, count, name) {
			do {
				current.$$listenerCount[name] -= count;

				if (current.$$listenerCount[name] === 0) {
					delete current.$$listenerCount[name];
				}
			} while ((current = current.$parent));
		}

		function initWatchVal() {}

		function flushApplyAsync() {
			while (applyAsyncQueue.length) {
				try {
					applyAsyncQueue.shift()();
				} catch (e) {
					$exceptionHandler(e);
				}
			}
			applyAsyncId = null;
		}

		function scheduleApplyAsync() {
			if (applyAsyncId === null) {
				applyAsyncId = $browser.defer(function() {
					$rootScope.$apply(flushApplyAsync);
				});
			}
		}
	}];
}

// the implementation is in angular.bootstrap

function $$SanitizeUriProvider() {
	var aHrefSanitizationWhitelist = /^\s*(https?|ftp|mailto|tel|file):/,
		imgSrcSanitizationWhitelist = /^\s*((https?|ftp|file|blob):|data:image\/)/;

	this.aHrefSanitizationWhitelist = function(regexp) {
		if (isDefined(regexp)) {
			aHrefSanitizationWhitelist = regexp;
			return this;
		}
		return aHrefSanitizationWhitelist;
	};

	this.imgSrcSanitizationWhitelist = function(regexp) {
		if (isDefined(regexp)) {
			imgSrcSanitizationWhitelist = regexp;
			return this;
		}
		return imgSrcSanitizationWhitelist;
	};

	this.$get = function() {
		return function sanitizeUri(uri, isImage) {
			var regex = isImage ? imgSrcSanitizationWhitelist : aHrefSanitizationWhitelist;
			var normalizedVal;
			normalizedVal = urlResolve(uri).href;
			if (normalizedVal !== '' && !normalizedVal.match(regex)) {
				return 'unsafe:' + normalizedVal;
			}
			return uri;
		};
	};
}

var $sceMinErr = minErr('$sce');

var SCE_CONTEXTS = {
	HTML: 'html',
	CSS: 'css',
	URL: 'url',
	// RESOURCE_URL is a subtype of URL used in contexts where a privileged resource is sourced from a
	// url.  (e.g. ng-include, script src, templateUrl)
	RESOURCE_URL: 'resourceUrl',
	JS: 'js'
};

// Helper functions follow.

function adjustMatcher(matcher) {
	if (matcher === 'self') {
		return matcher;
	} else if (isString(matcher)) {
		// Strings match exactly except for 2 wildcards - '*' and '**'.
		// '*' matches any character except those from the set ':/.?&'.
		// '**' matches any character (like .* in a RegExp).
		// More than 2 *'s raises an error as it's ill defined.
		if (matcher.indexOf('***') > -1) {
			throw $sceMinErr('iwcard',
					'Illegal sequence *** in string matcher.  String: {0}', matcher);
		}
		matcher = escapeForRegexp(matcher).
									replace('\\*\\*', '.*').
									replace('\\*', '[^:/.?&;]*');
		return new RegExp('^' + matcher + '$');
	} else if (isRegExp(matcher)) {
		// The only other type of matcher allowed is a Regexp.
		// Match entire URL / disallow partial matches.
		// Flags are reset (i.e. no global, ignoreCase or multiline)
		return new RegExp('^' + matcher.source + '$');
	} else {
		throw $sceMinErr('imatcher',
				'Matchers may only be "self", string patterns or RegExp objects');
	}
}

function adjustMatchers(matchers) {
	var adjustedMatchers = [];
	if (isDefined(matchers)) {
		forEach(matchers, function(matcher) {
			adjustedMatchers.push(adjustMatcher(matcher));
		});
	}
	return adjustedMatchers;
}

function $SceDelegateProvider() {
	this.SCE_CONTEXTS = SCE_CONTEXTS;

	// Resource URLs can also be trusted by policy.
	var resourceUrlWhitelist = ['self'],
			resourceUrlBlacklist = [];

	this.resourceUrlWhitelist = function(value) {
		if (arguments.length) {
			resourceUrlWhitelist = adjustMatchers(value);
		}
		return resourceUrlWhitelist;
	};

	this.resourceUrlBlacklist = function(value) {
		if (arguments.length) {
			resourceUrlBlacklist = adjustMatchers(value);
		}
		return resourceUrlBlacklist;
	};

	this.$get = ['$injector', function($injector) {

		var htmlSanitizer = function htmlSanitizer(html) {
			throw $sceMinErr('unsafe', 'Attempting to use an unsafe value in a safe context.');
		};

		if ($injector.has('$sanitize')) {
			htmlSanitizer = $injector.get('$sanitize');
		}

		function matchUrl(matcher, parsedUrl) {
			if (matcher === 'self') {
				return urlIsSameOrigin(parsedUrl);
			} else {
				// definitely a regex.  See adjustMatchers()
				return !!matcher.exec(parsedUrl.href);
			}
		}

		function isResourceUrlAllowedByPolicy(url) {
			var parsedUrl = urlResolve(url.toString());
			var i, n, allowed = false;
			// Ensure that at least one item from the whitelist allows this url.
			for (i = 0, n = resourceUrlWhitelist.length; i < n; i++) {
				if (matchUrl(resourceUrlWhitelist[i], parsedUrl)) {
					allowed = true;
					break;
				}
			}
			if (allowed) {
				// Ensure that no item from the blacklist blocked this url.
				for (i = 0, n = resourceUrlBlacklist.length; i < n; i++) {
					if (matchUrl(resourceUrlBlacklist[i], parsedUrl)) {
						allowed = false;
						break;
					}
				}
			}
			return allowed;
		}

		function generateHolderType(Base) {
			var holderType = function TrustedValueHolderType(trustedValue) {
				this.$$unwrapTrustedValue = function() {
					return trustedValue;
				};
			};
			if (Base) {
				holderType.prototype = new Base();
			}
			holderType.prototype.valueOf = function sceValueOf() {
				return this.$$unwrapTrustedValue();
			};
			holderType.prototype.toString = function sceToString() {
				return this.$$unwrapTrustedValue().toString();
			};
			return holderType;
		}

		var trustedValueHolderBase = generateHolderType(),
				byType = {};

		byType[SCE_CONTEXTS.HTML] = generateHolderType(trustedValueHolderBase);
		byType[SCE_CONTEXTS.CSS] = generateHolderType(trustedValueHolderBase);
		byType[SCE_CONTEXTS.URL] = generateHolderType(trustedValueHolderBase);
		byType[SCE_CONTEXTS.JS] = generateHolderType(trustedValueHolderBase);
		byType[SCE_CONTEXTS.RESOURCE_URL] = generateHolderType(byType[SCE_CONTEXTS.URL]);

		function trustAs(type, trustedValue) {
			var Constructor = (byType.hasOwnProperty(type) ? byType[type] : null);
			if (!Constructor) {
				throw $sceMinErr('icontext',
						'Attempted to trust a value in invalid context. Context: {0}; Value: {1}',
						type, trustedValue);
			}
			if (trustedValue === null || isUndefined(trustedValue) || trustedValue === '') {
				return trustedValue;
			}
			// All the current contexts in SCE_CONTEXTS happen to be strings.  In order to avoid trusting
			// mutable objects, we ensure here that the value passed in is actually a string.
			if (typeof trustedValue !== 'string') {
				throw $sceMinErr('itype',
						'Attempted to trust a non-string value in a content requiring a string: Context: {0}',
						type);
			}
			return new Constructor(trustedValue);
		}

		function valueOf(maybeTrusted) {
			if (maybeTrusted instanceof trustedValueHolderBase) {
				return maybeTrusted.$$unwrapTrustedValue();
			} else {
				return maybeTrusted;
			}
		}

		function getTrusted(type, maybeTrusted) {
			if (maybeTrusted === null || isUndefined(maybeTrusted) || maybeTrusted === '') {
				return maybeTrusted;
			}
			var constructor = (byType.hasOwnProperty(type) ? byType[type] : null);
			if (constructor && maybeTrusted instanceof constructor) {
				return maybeTrusted.$$unwrapTrustedValue();
			}
			// If we get here, then we may only take one of two actions.
			// 1. sanitize the value for the requested type, or
			// 2. throw an exception.
			if (type === SCE_CONTEXTS.RESOURCE_URL) {
				if (isResourceUrlAllowedByPolicy(maybeTrusted)) {
					return maybeTrusted;
				} else {
					throw $sceMinErr('insecurl',
							'Blocked loading resource from url not allowed by $sceDelegate policy.  URL: {0}',
							maybeTrusted.toString());
				}
			} else if (type === SCE_CONTEXTS.HTML) {
				return htmlSanitizer(maybeTrusted);
			}
			throw $sceMinErr('unsafe', 'Attempting to use an unsafe value in a safe context.');
		}

		return { trustAs: trustAs,
						 getTrusted: getTrusted,
						 valueOf: valueOf };
	}];
}

function $SceProvider() {
	var enabled = true;

	this.enabled = function(value) {
		if (arguments.length) {
			enabled = !!value;
		}
		return enabled;
	};

	this.$get = ['$parse', '$sceDelegate', function(
								$parse,   $sceDelegate) {
		// Prereq: Ensure that we're not running in IE<11 quirks mode.  In that mode, IE < 11 allow
		// the "expression(javascript expression)" syntax which is insecure.
		if (enabled && msie < 8) {
			throw $sceMinErr('iequirks',
				'Strict Contextual Escaping does not support Internet Explorer version < 11 in quirks ' +
				'mode.  You can fix this by adding the text <!doctype html> to the top of your HTML ' +
				'document.  See http://docs.angularjs.org/api/ng.$sce for more information.');
		}

		var sce = shallowCopy(SCE_CONTEXTS);

		sce.isEnabled = function() {
			return enabled;
		};
		sce.trustAs = $sceDelegate.trustAs;
		sce.getTrusted = $sceDelegate.getTrusted;
		sce.valueOf = $sceDelegate.valueOf;

		if (!enabled) {
			sce.trustAs = sce.getTrusted = function(type, value) { return value; };
			sce.valueOf = identity;
		}

		sce.parseAs = function sceParseAs(type, expr) {
			var parsed = $parse(expr);
			if (parsed.literal && parsed.constant) {
				return parsed;
			} else {
				return $parse(expr, function(value) {
					return sce.getTrusted(type, value);
				});
			}
		};

		// Shorthand delegations.
		var parse = sce.parseAs,
				getTrusted = sce.getTrusted,
				trustAs = sce.trustAs;

		forEach(SCE_CONTEXTS, function(enumValue, name) {
			var lName = lowercase(name);
			sce[camelCase("parse_as_" + lName)] = function(expr) {
				return parse(enumValue, expr);
			};
			sce[camelCase("get_trusted_" + lName)] = function(value) {
				return getTrusted(enumValue, value);
			};
			sce[camelCase("trust_as_" + lName)] = function(value) {
				return trustAs(enumValue, value);
			};
		});

		return sce;
	}];
}

function $SnifferProvider() {
	this.$get = ['$window', '$document', function($window, $document) {
		var eventSupport = {},
				// Chrome Packaged Apps are not allowed to access `history.pushState`. They can be detected by
				// the presence of `chrome.app.runtime` (see https://developer.chrome.com/apps/api_index)
				isChromePackagedApp = $window.chrome && $window.chrome.app && $window.chrome.app.runtime,
				hasHistoryPushState = !isChromePackagedApp && $window.history && $window.history.pushState,
				android =
					toInt((/android (\d+)/.exec(lowercase(($window.navigator || {}).userAgent)) || [])[1]),
				boxee = /Boxee/i.test(($window.navigator || {}).userAgent),
				document = $document[0] || {},
				vendorPrefix,
				vendorRegex = /^(Moz|webkit|ms)(?=[A-Z])/,
				bodyStyle = document.body && document.body.style,
				transitions = false,
				animations = false,
				match;

		if (bodyStyle) {
			for (var prop in bodyStyle) {
				if (match = vendorRegex.exec(prop)) {
					vendorPrefix = match[0];
					vendorPrefix = vendorPrefix[0].toUpperCase() + vendorPrefix.substr(1);
					break;
				}
			}

			if (!vendorPrefix) {
				vendorPrefix = ('WebkitOpacity' in bodyStyle) && 'webkit';
			}

			transitions = !!(('transition' in bodyStyle) || (vendorPrefix + 'Transition' in bodyStyle));
			animations  = !!(('animation' in bodyStyle) || (vendorPrefix + 'Animation' in bodyStyle));

			if (android && (!transitions ||  !animations)) {
				transitions = isString(bodyStyle.webkitTransition);
				animations = isString(bodyStyle.webkitAnimation);
			}
		}

		return {
			// Android has history.pushState, but it does not update location correctly
			// so let's not use the history API at all.
			// http://code.google.com/p/android/issues/detail?id=17471
			// https://github.com/angular/angular.js/issues/904

			// older webkit browser (533.9) on Boxee box has exactly the same problem as Android has
			// so let's not use the history API also
			// We are purposefully using `!(android < 4)` to cover the case when `android` is undefined
			// jshint -W018
			history: !!(hasHistoryPushState && !(android < 4) && !boxee),
			// jshint +W018
			hasEvent: function(event) {
				// IE9 implements 'input' event it's so fubared that we rather pretend that it doesn't have
				// it. In particular the event is not fired when backspace or delete key are pressed or
				// when cut operation is performed.
				// IE10+ implements 'input' event but it erroneously fires under various situations,
				// e.g. when placeholder changes, or a form is focused.
				if (event === 'input' && msie <= 11) return false;

				if (isUndefined(eventSupport[event])) {
					var divElm = document.createElement('div');
					eventSupport[event] = 'on' + event in divElm;
				}

				return eventSupport[event];
			},
			csp: csp(),
			vendorPrefix: vendorPrefix,
			transitions: transitions,
			animations: animations,
			android: android
		};
	}];
}

var $templateRequestMinErr = minErr('$compile');

function $TemplateRequestProvider() {

	var httpOptions;

	this.httpOptions = function(val) {
		if (val) {
			httpOptions = val;
			return this;
		}
		return httpOptions;
	};

	this.$get = ['$templateCache', '$http', '$q', '$sce', function($templateCache, $http, $q, $sce) {

		function handleRequestFn(tpl, ignoreRequestError) {
			handleRequestFn.totalPendingRequests++;

			// We consider the template cache holds only trusted templates, so
			// there's no need to go through whitelisting again for keys that already
			// are included in there. This also makes Angular accept any script
			// directive, no matter its name. However, we still need to unwrap trusted
			// types.
			if (!isString(tpl) || isUndefined($templateCache.get(tpl))) {
				tpl = $sce.getTrustedResourceUrl(tpl);
			}

			var transformResponse = $http.defaults && $http.defaults.transformResponse;

			if (isArray(transformResponse)) {
				transformResponse = transformResponse.filter(function(transformer) {
					return transformer !== defaultHttpResponseTransform;
				});
			} else if (transformResponse === defaultHttpResponseTransform) {
				transformResponse = null;
			}

			return $http.get(tpl, extend({
					cache: $templateCache,
					transformResponse: transformResponse
				}, httpOptions))
				['finally'](function() {
					handleRequestFn.totalPendingRequests--;
				})
				.then(function(response) {
					$templateCache.put(tpl, response.data);
					return response.data;
				}, handleError);

			function handleError(resp) {
				if (!ignoreRequestError) {
					throw $templateRequestMinErr('tpload', 'Failed to load template: {0} (HTTP status: {1} {2})',
						tpl, resp.status, resp.statusText);
				}
				return $q.reject(resp);
			}
		}

		handleRequestFn.totalPendingRequests = 0;

		return handleRequestFn;
	}];
}

function $$TestabilityProvider() {
	this.$get = ['$rootScope', '$browser', '$location',
			 function($rootScope,   $browser,   $location) {

		var testability = {};

		testability.findBindings = function(element, expression, opt_exactMatch) {
			var bindings = element.getElementsByClassName('ng-binding');
			var matches = [];
			forEach(bindings, function(binding) {
				var dataBinding = angular.element(binding).data('$binding');
				if (dataBinding) {
					forEach(dataBinding, function(bindingName) {
						if (opt_exactMatch) {
							var matcher = new RegExp('(^|\\s)' + escapeForRegexp(expression) + '(\\s|\\||$)');
							if (matcher.test(bindingName)) {
								matches.push(binding);
							}
						} else {
							if (bindingName.indexOf(expression) != -1) {
								matches.push(binding);
							}
						}
					});
				}
			});
			return matches;
		};

		testability.findModels = function(element, expression, opt_exactMatch) {
			var prefixes = ['ng-', 'data-ng-', 'ng\\:'];
			for (var p = 0; p < prefixes.length; ++p) {
				var attributeEquals = opt_exactMatch ? '=' : '*=';
				var selector = '[' + prefixes[p] + 'model' + attributeEquals + '"' + expression + '"]';
				var elements = element.querySelectorAll(selector);
				if (elements.length) {
					return elements;
				}
			}
		};

		testability.getLocation = function() {
			return $location.url();
		};

		testability.setLocation = function(url) {
			if (url !== $location.url()) {
				$location.url(url);
				$rootScope.$digest();
			}
		};

		testability.whenStable = function(callback) {
			$browser.notifyWhenNoOutstandingRequests(callback);
		};

		return testability;
	}];
}

function $TimeoutProvider() {
	this.$get = ['$rootScope', '$browser', '$q', '$$q', '$exceptionHandler',
			 function($rootScope,   $browser,   $q,   $$q,   $exceptionHandler) {

		var deferreds = {};

		function timeout(fn, delay, invokeApply) {
			if (!isFunction(fn)) {
				invokeApply = delay;
				delay = fn;
				fn = noop;
			}

			var args = sliceArgs(arguments, 3),
					skipApply = (isDefined(invokeApply) && !invokeApply),
					deferred = (skipApply ? $$q : $q).defer(),
					promise = deferred.promise,
					timeoutId;

			timeoutId = $browser.defer(function() {
				try {
					deferred.resolve(fn.apply(null, args));
				} catch (e) {
					deferred.reject(e);
					$exceptionHandler(e);
				}
				finally {
					delete deferreds[promise.$$timeoutId];
				}

				if (!skipApply) $rootScope.$apply();
			}, delay);

			promise.$$timeoutId = timeoutId;
			deferreds[timeoutId] = deferred;

			return promise;
		}

		timeout.cancel = function(promise) {
			if (promise && promise.$$timeoutId in deferreds) {
				deferreds[promise.$$timeoutId].reject('canceled');
				delete deferreds[promise.$$timeoutId];
				return $browser.defer.cancel(promise.$$timeoutId);
			}
			return false;
		};

		return timeout;
	}];
}

// NOTE:  The usage of window and document instead of $window and $document here is
// deliberate.  This service depends on the specific behavior of anchor nodes created by the
// browser (resolving and parsing URLs) that is unlikely to be provided by mock objects and
// cause us to break tests.  In addition, when the browser resolves a URL for XHR, it
// doesn't know about mocked locations and resolves URLs to the real document - which is
// exactly the behavior needed here.  There is little value is mocking these out for this
// service.
var urlParsingNode = window.document.createElement("a");
var originUrl = urlResolve(window.location.href);

function urlResolve(url) {
	var href = url;

	if (msie) {
		// Normalize before parse.  Refer Implementation Notes on why this is
		// done in two steps on IE.
		urlParsingNode.setAttribute("href", href);
		href = urlParsingNode.href;
	}

	urlParsingNode.setAttribute('href', href);

	// urlParsingNode provides the UrlUtils interface - http://url.spec.whatwg.org/#urlutils
	return {
		href: urlParsingNode.href,
		protocol: urlParsingNode.protocol ? urlParsingNode.protocol.replace(/:$/, '') : '',
		host: urlParsingNode.host,
		search: urlParsingNode.search ? urlParsingNode.search.replace(/^\?/, '') : '',
		hash: urlParsingNode.hash ? urlParsingNode.hash.replace(/^#/, '') : '',
		hostname: urlParsingNode.hostname,
		port: urlParsingNode.port,
		pathname: (urlParsingNode.pathname.charAt(0) === '/')
			? urlParsingNode.pathname
			: '/' + urlParsingNode.pathname
	};
}

function urlIsSameOrigin(requestUrl) {
	var parsed = (isString(requestUrl)) ? urlResolve(requestUrl) : requestUrl;
	return (parsed.protocol === originUrl.protocol &&
					parsed.host === originUrl.host);
}

function $WindowProvider() {
	this.$get = valueFn(window);
}

function $$CookieReader($document) {
	var rawDocument = $document[0] || {};
	var lastCookies = {};
	var lastCookieString = '';

	function safeDecodeURIComponent(str) {
		try {
			return decodeURIComponent(str);
		} catch (e) {
			return str;
		}
	}

	return function() {
		var cookieArray, cookie, i, index, name;
		var currentCookieString = rawDocument.cookie || '';

		if (currentCookieString !== lastCookieString) {
			lastCookieString = currentCookieString;
			cookieArray = lastCookieString.split('; ');
			lastCookies = {};

			for (i = 0; i < cookieArray.length; i++) {
				cookie = cookieArray[i];
				index = cookie.indexOf('=');
				if (index > 0) { //ignore nameless cookies
					name = safeDecodeURIComponent(cookie.substring(0, index));
					// the first value that is seen for a cookie is the most
					// specific one.  values for the same cookie name that
					// follow are for less specific paths.
					if (isUndefined(lastCookies[name])) {
						lastCookies[name] = safeDecodeURIComponent(cookie.substring(index + 1));
					}
				}
			}
		}
		return lastCookies;
	};
}

$$CookieReader.$inject = ['$document'];

function $$CookieReaderProvider() {
	this.$get = $$CookieReader;
}

$FilterProvider.$inject = ['$provide'];
function $FilterProvider($provide) {
	var suffix = 'Filter';

	function register(name, factory) {
		if (isObject(name)) {
			var filters = {};
			forEach(name, function(filter, key) {
				filters[key] = register(key, filter);
			});
			return filters;
		} else {
			return $provide.factory(name + suffix, factory);
		}
	}
	this.register = register;

	this.$get = ['$injector', function($injector) {
		return function(name) {
			return $injector.get(name + suffix);
		};
	}];

	////////////////////////////////////////

	register('currency', currencyFilter);
	register('date', dateFilter);
	register('filter', filterFilter);
	register('json', jsonFilter);
	register('limitTo', limitToFilter);
	register('lowercase', lowercaseFilter);
	register('number', numberFilter);
	register('orderBy', orderByFilter);
	register('uppercase', uppercaseFilter);
}

function filterFilter() {
	return function(array, expression, comparator) {
		if (!isArrayLike(array)) {
			if (array == null) {
				return array;
			} else {
				throw minErr('filter')('notarray', 'Expected array but received: {0}', array);
			}
		}

		var expressionType = getTypeForFilter(expression);
		var predicateFn;
		var matchAgainstAnyProp;

		switch (expressionType) {
			case 'function':
				predicateFn = expression;
				break;
			case 'boolean':
			case 'null':
			case 'number':
			case 'string':
				matchAgainstAnyProp = true;
				//jshint -W086
			case 'object':
				//jshint +W086
				predicateFn = createPredicateFn(expression, comparator, matchAgainstAnyProp);
				break;
			default:
				return array;
		}

		return Array.prototype.filter.call(array, predicateFn);
	};
}

// Helper functions for `filterFilter`
function createPredicateFn(expression, comparator, matchAgainstAnyProp) {
	var shouldMatchPrimitives = isObject(expression) && ('$' in expression);
	var predicateFn;

	if (comparator === true) {
		comparator = equals;
	} else if (!isFunction(comparator)) {
		comparator = function(actual, expected) {
			if (isUndefined(actual)) {
				// No substring matching against `undefined`
				return false;
			}
			if ((actual === null) || (expected === null)) {
				// No substring matching against `null`; only match against `null`
				return actual === expected;
			}
			if (isObject(expected) || (isObject(actual) && !hasCustomToString(actual))) {
				// Should not compare primitives against objects, unless they have custom `toString` method
				return false;
			}

			actual = lowercase('' + actual);
			expected = lowercase('' + expected);
			return actual.indexOf(expected) !== -1;
		};
	}

	predicateFn = function(item) {
		if (shouldMatchPrimitives && !isObject(item)) {
			return deepCompare(item, expression.$, comparator, false);
		}
		return deepCompare(item, expression, comparator, matchAgainstAnyProp);
	};

	return predicateFn;
}

function deepCompare(actual, expected, comparator, matchAgainstAnyProp, dontMatchWholeObject) {
	var actualType = getTypeForFilter(actual);
	var expectedType = getTypeForFilter(expected);

	if ((expectedType === 'string') && (expected.charAt(0) === '!')) {
		return !deepCompare(actual, expected.substring(1), comparator, matchAgainstAnyProp);
	} else if (isArray(actual)) {
		// In case `actual` is an array, consider it a match
		// if ANY of it's items matches `expected`
		return actual.some(function(item) {
			return deepCompare(item, expected, comparator, matchAgainstAnyProp);
		});
	}

	switch (actualType) {
		case 'object':
			var key;
			if (matchAgainstAnyProp) {
				for (key in actual) {
					if ((key.charAt(0) !== '$') && deepCompare(actual[key], expected, comparator, true)) {
						return true;
					}
				}
				return dontMatchWholeObject ? false : deepCompare(actual, expected, comparator, false);
			} else if (expectedType === 'object') {
				for (key in expected) {
					var expectedVal = expected[key];
					if (isFunction(expectedVal) || isUndefined(expectedVal)) {
						continue;
					}

					var matchAnyProperty = key === '$';
					var actualVal = matchAnyProperty ? actual : actual[key];
					if (!deepCompare(actualVal, expectedVal, comparator, matchAnyProperty, matchAnyProperty)) {
						return false;
					}
				}
				return true;
			} else {
				return comparator(actual, expected);
			}
			break;
		case 'function':
			return false;
		default:
			return comparator(actual, expected);
	}
}

// Used for easily differentiating between `null` and actual `object`
function getTypeForFilter(val) {
	return (val === null) ? 'null' : typeof val;
}

var MAX_DIGITS = 22;
var DECIMAL_SEP = '.';
var ZERO_CHAR = '0';

currencyFilter.$inject = ['$locale'];
function currencyFilter($locale) {
	var formats = $locale.NUMBER_FORMATS;
	return function(amount, currencySymbol, fractionSize) {
		if (isUndefined(currencySymbol)) {
			currencySymbol = formats.CURRENCY_SYM;
		}

		if (isUndefined(fractionSize)) {
			fractionSize = formats.PATTERNS[1].maxFrac;
		}

		// if null or undefined pass it through
		return (amount == null)
				? amount
				: formatNumber(amount, formats.PATTERNS[1], formats.GROUP_SEP, formats.DECIMAL_SEP, fractionSize).
						replace(/\u00A4/g, currencySymbol);
	};
}

numberFilter.$inject = ['$locale'];
function numberFilter($locale) {
	var formats = $locale.NUMBER_FORMATS;
	return function(number, fractionSize) {

		// if null or undefined pass it through
		return (number == null)
				? number
				: formatNumber(number, formats.PATTERNS[0], formats.GROUP_SEP, formats.DECIMAL_SEP,
											 fractionSize);
	};
}

function parse(numStr) {
	var exponent = 0, digits, numberOfIntegerDigits;
	var i, j, zeros;

	// Decimal point?
	if ((numberOfIntegerDigits = numStr.indexOf(DECIMAL_SEP)) > -1) {
		numStr = numStr.replace(DECIMAL_SEP, '');
	}

	// Exponential form?
	if ((i = numStr.search(/e/i)) > 0) {
		// Work out the exponent.
		if (numberOfIntegerDigits < 0) numberOfIntegerDigits = i;
		numberOfIntegerDigits += +numStr.slice(i + 1);
		numStr = numStr.substring(0, i);
	} else if (numberOfIntegerDigits < 0) {
		// There was no decimal point or exponent so it is an integer.
		numberOfIntegerDigits = numStr.length;
	}

	// Count the number of leading zeros.
	for (i = 0; numStr.charAt(i) == ZERO_CHAR; i++) {}

	if (i == (zeros = numStr.length)) {
		// The digits are all zero.
		digits = [0];
		numberOfIntegerDigits = 1;
	} else {
		// Count the number of trailing zeros
		zeros--;
		while (numStr.charAt(zeros) == ZERO_CHAR) zeros--;

		// Trailing zeros are insignificant so ignore them
		numberOfIntegerDigits -= i;
		digits = [];
		// Convert string to array of digits without leading/trailing zeros.
		for (j = 0; i <= zeros; i++, j++) {
			digits[j] = +numStr.charAt(i);
		}
	}

	// If the number overflows the maximum allowed digits then use an exponent.
	if (numberOfIntegerDigits > MAX_DIGITS) {
		digits = digits.splice(0, MAX_DIGITS - 1);
		exponent = numberOfIntegerDigits - 1;
		numberOfIntegerDigits = 1;
	}

	return { d: digits, e: exponent, i: numberOfIntegerDigits };
}

function roundNumber(parsedNumber, fractionSize, minFrac, maxFrac) {
		var digits = parsedNumber.d;
		var fractionLen = digits.length - parsedNumber.i;

		// determine fractionSize if it is not specified; `+fractionSize` converts it to a number
		fractionSize = (isUndefined(fractionSize)) ? Math.min(Math.max(minFrac, fractionLen), maxFrac) : +fractionSize;

		// The index of the digit to where rounding is to occur
		var roundAt = fractionSize + parsedNumber.i;
		var digit = digits[roundAt];

		if (roundAt > 0) {
			// Drop fractional digits beyond `roundAt`
			digits.splice(Math.max(parsedNumber.i, roundAt));

			// Set non-fractional digits beyond `roundAt` to 0
			for (var j = roundAt; j < digits.length; j++) {
				digits[j] = 0;
			}
		} else {
			// We rounded to zero so reset the parsedNumber
			fractionLen = Math.max(0, fractionLen);
			parsedNumber.i = 1;
			digits.length = Math.max(1, roundAt = fractionSize + 1);
			digits[0] = 0;
			for (var i = 1; i < roundAt; i++) digits[i] = 0;
		}

		if (digit >= 5) {
			if (roundAt - 1 < 0) {
				for (var k = 0; k > roundAt; k--) {
					digits.unshift(0);
					parsedNumber.i++;
				}
				digits.unshift(1);
				parsedNumber.i++;
			} else {
				digits[roundAt - 1]++;
			}
		}

		// Pad out with zeros to get the required fraction length
		for (; fractionLen < Math.max(0, fractionSize); fractionLen++) digits.push(0);

		// Do any carrying, e.g. a digit was rounded up to 10
		var carry = digits.reduceRight(function(carry, d, i, digits) {
			d = d + carry;
			digits[i] = d % 10;
			return Math.floor(d / 10);
		}, 0);
		if (carry) {
			digits.unshift(carry);
			parsedNumber.i++;
		}
}

function formatNumber(number, pattern, groupSep, decimalSep, fractionSize) {

	if (!(isString(number) || isNumber(number)) || isNaN(number)) return '';

	var isInfinity = !isFinite(number);
	var isZero = false;
	var numStr = Math.abs(number) + '',
			formattedText = '',
			parsedNumber;

	if (isInfinity) {
		formattedText = '\u221e';
	} else {
		parsedNumber = parse(numStr);

		roundNumber(parsedNumber, fractionSize, pattern.minFrac, pattern.maxFrac);

		var digits = parsedNumber.d;
		var integerLen = parsedNumber.i;
		var exponent = parsedNumber.e;
		var decimals = [];
		isZero = digits.reduce(function(isZero, d) { return isZero && !d; }, true);

		// pad zeros for small numbers
		while (integerLen < 0) {
			digits.unshift(0);
			integerLen++;
		}

		// extract decimals digits
		if (integerLen > 0) {
			decimals = digits.splice(integerLen, digits.length);
		} else {
			decimals = digits;
			digits = [0];
		}

		// format the integer digits with grouping separators
		var groups = [];
		if (digits.length >= pattern.lgSize) {
			groups.unshift(digits.splice(-pattern.lgSize, digits.length).join(''));
		}
		while (digits.length > pattern.gSize) {
			groups.unshift(digits.splice(-pattern.gSize, digits.length).join(''));
		}
		if (digits.length) {
			groups.unshift(digits.join(''));
		}
		formattedText = groups.join(groupSep);

		// append the decimal digits
		if (decimals.length) {
			formattedText += decimalSep + decimals.join('');
		}

		if (exponent) {
			formattedText += 'e+' + exponent;
		}
	}
	if (number < 0 && !isZero) {
		return pattern.negPre + formattedText + pattern.negSuf;
	} else {
		return pattern.posPre + formattedText + pattern.posSuf;
	}
}

function padNumber(num, digits, trim, negWrap) {
	var neg = '';
	if (num < 0 || (negWrap && num <= 0)) {
		if (negWrap) {
			num = -num + 1;
		} else {
			num = -num;
			neg = '-';
		}
	}
	num = '' + num;
	while (num.length < digits) num = ZERO_CHAR + num;
	if (trim) {
		num = num.substr(num.length - digits);
	}
	return neg + num;
}

function dateGetter(name, size, offset, trim, negWrap) {
	offset = offset || 0;
	return function(date) {
		var value = date['get' + name]();
		if (offset > 0 || value > -offset) {
			value += offset;
		}
		if (value === 0 && offset == -12) value = 12;
		return padNumber(value, size, trim, negWrap);
	};
}

function dateStrGetter(name, shortForm, standAlone) {
	return function(date, formats) {
		var value = date['get' + name]();
		var propPrefix = (standAlone ? 'STANDALONE' : '') + (shortForm ? 'SHORT' : '');
		var get = uppercase(propPrefix + name);

		return formats[get][value];
	};
}

function timeZoneGetter(date, formats, offset) {
	var zone = -1 * offset;
	var paddedZone = (zone >= 0) ? "+" : "";

	paddedZone += padNumber(Math[zone > 0 ? 'floor' : 'ceil'](zone / 60), 2) +
								padNumber(Math.abs(zone % 60), 2);

	return paddedZone;
}

function getFirstThursdayOfYear(year) {
		// 0 = index of January
		var dayOfWeekOnFirst = (new Date(year, 0, 1)).getDay();
		// 4 = index of Thursday (+1 to account for 1st = 5)
		// 11 = index of *next* Thursday (+1 account for 1st = 12)
		return new Date(year, 0, ((dayOfWeekOnFirst <= 4) ? 5 : 12) - dayOfWeekOnFirst);
}

function getThursdayThisWeek(datetime) {
		return new Date(datetime.getFullYear(), datetime.getMonth(),
			// 4 = index of Thursday
			datetime.getDate() + (4 - datetime.getDay()));
}

function weekGetter(size) {
	 return function(date) {
			var firstThurs = getFirstThursdayOfYear(date.getFullYear()),
				 thisThurs = getThursdayThisWeek(date);

			var diff = +thisThurs - +firstThurs,
				 result = 1 + Math.round(diff / 6.048e8); // 6.048e8 ms per week

			return padNumber(result, size);
	 };
}

function ampmGetter(date, formats) {
	return date.getHours() < 12 ? formats.AMPMS[0] : formats.AMPMS[1];
}

function eraGetter(date, formats) {
	return date.getFullYear() <= 0 ? formats.ERAS[0] : formats.ERAS[1];
}

function longEraGetter(date, formats) {
	return date.getFullYear() <= 0 ? formats.ERANAMES[0] : formats.ERANAMES[1];
}

var DATE_FORMATS = {
	yyyy: dateGetter('FullYear', 4, 0, false, true),
		yy: dateGetter('FullYear', 2, 0, true, true),
		 y: dateGetter('FullYear', 1, 0, false, true),
	MMMM: dateStrGetter('Month'),
	 MMM: dateStrGetter('Month', true),
		MM: dateGetter('Month', 2, 1),
		 M: dateGetter('Month', 1, 1),
	LLLL: dateStrGetter('Month', false, true),
		dd: dateGetter('Date', 2),
		 d: dateGetter('Date', 1),
		HH: dateGetter('Hours', 2),
		 H: dateGetter('Hours', 1),
		hh: dateGetter('Hours', 2, -12),
		 h: dateGetter('Hours', 1, -12),
		mm: dateGetter('Minutes', 2),
		 m: dateGetter('Minutes', 1),
		ss: dateGetter('Seconds', 2),
		 s: dateGetter('Seconds', 1),
		 // while ISO 8601 requires fractions to be prefixed with `.` or `,`
		 // we can be just safely rely on using `sss` since we currently don't support single or two digit fractions
	 sss: dateGetter('Milliseconds', 3),
	EEEE: dateStrGetter('Day'),
	 EEE: dateStrGetter('Day', true),
		 a: ampmGetter,
		 Z: timeZoneGetter,
		ww: weekGetter(2),
		 w: weekGetter(1),
		 G: eraGetter,
		 GG: eraGetter,
		 GGG: eraGetter,
		 GGGG: longEraGetter
};

var DATE_FORMATS_SPLIT = /((?:[^yMLdHhmsaZEwG']+)|(?:'(?:[^']|'')*')|(?:E+|y+|M+|L+|d+|H+|h+|m+|s+|a|Z|G+|w+))(.*)/,
		NUMBER_STRING = /^\-?\d+$/;

dateFilter.$inject = ['$locale'];
function dateFilter($locale) {

	var R_ISO8601_STR = /^(\d{4})-?(\d\d)-?(\d\d)(?:T(\d\d)(?::?(\d\d)(?::?(\d\d)(?:\.(\d+))?)?)?(Z|([+-])(\d\d):?(\d\d))?)?$/;
										 // 1        2       3         4          5          6          7          8  9     10      11
	function jsonStringToDate(string) {
		var match;
		if (match = string.match(R_ISO8601_STR)) {
			var date = new Date(0),
					tzHour = 0,
					tzMin  = 0,
					dateSetter = match[8] ? date.setUTCFullYear : date.setFullYear,
					timeSetter = match[8] ? date.setUTCHours : date.setHours;

			if (match[9]) {
				tzHour = toInt(match[9] + match[10]);
				tzMin = toInt(match[9] + match[11]);
			}
			dateSetter.call(date, toInt(match[1]), toInt(match[2]) - 1, toInt(match[3]));
			var h = toInt(match[4] || 0) - tzHour;
			var m = toInt(match[5] || 0) - tzMin;
			var s = toInt(match[6] || 0);
			var ms = Math.round(parseFloat('0.' + (match[7] || 0)) * 1000);
			timeSetter.call(date, h, m, s, ms);
			return date;
		}
		return string;
	}

	return function(date, format, timezone) {
		var text = '',
				parts = [],
				fn, match;

		format = format || 'mediumDate';
		format = $locale.DATETIME_FORMATS[format] || format;
		if (isString(date)) {
			date = NUMBER_STRING.test(date) ? toInt(date) : jsonStringToDate(date);
		}

		if (isNumber(date)) {
			date = new Date(date);
		}

		if (!isDate(date) || !isFinite(date.getTime())) {
			return date;
		}

		while (format) {
			match = DATE_FORMATS_SPLIT.exec(format);
			if (match) {
				parts = concat(parts, match, 1);
				format = parts.pop();
			} else {
				parts.push(format);
				format = null;
			}
		}

		var dateTimezoneOffset = date.getTimezoneOffset();
		if (timezone) {
			dateTimezoneOffset = timezoneToOffset(timezone, dateTimezoneOffset);
			date = convertTimezoneToLocal(date, timezone, true);
		}
		forEach(parts, function(value) {
			fn = DATE_FORMATS[value];
			text += fn ? fn(date, $locale.DATETIME_FORMATS, dateTimezoneOffset)
								 : value === "''" ? "'" : value.replace(/(^'|'$)/g, '').replace(/''/g, "'");
		});

		return text;
	};
}

function jsonFilter() {
	return function(object, spacing) {
		if (isUndefined(spacing)) {
				spacing = 2;
		}
		return toJson(object, spacing);
	};
}

var lowercaseFilter = valueFn(lowercase);

var uppercaseFilter = valueFn(uppercase);

function limitToFilter() {
	return function(input, limit, begin) {
		if (Math.abs(Number(limit)) === Infinity) {
			limit = Number(limit);
		} else {
			limit = toInt(limit);
		}
		if (isNaN(limit)) return input;

		if (isNumber(input)) input = input.toString();
		if (!isArray(input) && !isString(input)) return input;

		begin = (!begin || isNaN(begin)) ? 0 : toInt(begin);
		begin = (begin < 0) ? Math.max(0, input.length + begin) : begin;

		if (limit >= 0) {
			return input.slice(begin, begin + limit);
		} else {
			if (begin === 0) {
				return input.slice(limit, input.length);
			} else {
				return input.slice(Math.max(0, begin + limit), begin);
			}
		}
	};
}

orderByFilter.$inject = ['$parse'];
function orderByFilter($parse) {
	return function(array, sortPredicate, reverseOrder) {

		if (array == null) return array;
		if (!isArrayLike(array)) {
			throw minErr('orderBy')('notarray', 'Expected array but received: {0}', array);
		}

		if (!isArray(sortPredicate)) { sortPredicate = [sortPredicate]; }
		if (sortPredicate.length === 0) { sortPredicate = ['+']; }

		var predicates = processPredicates(sortPredicate, reverseOrder);
		// Add a predicate at the end that evaluates to the element index. This makes the
		// sort stable as it works as a tie-breaker when all the input predicates cannot
		// distinguish between two elements.
		predicates.push({ get: function() { return {}; }, descending: reverseOrder ? -1 : 1});

		// The next three lines are a version of a Swartzian Transform idiom from Perl
		// (sometimes called the Decorate-Sort-Undecorate idiom)
		// See https://en.wikipedia.org/wiki/Schwartzian_transform
		var compareValues = Array.prototype.map.call(array, getComparisonObject);
		compareValues.sort(doComparison);
		array = compareValues.map(function(item) { return item.value; });

		return array;

		function getComparisonObject(value, index) {
			return {
				value: value,
				predicateValues: predicates.map(function(predicate) {
					return getPredicateValue(predicate.get(value), index);
				})
			};
		}

		function doComparison(v1, v2) {
			var result = 0;
			for (var index=0, length = predicates.length; index < length; ++index) {
				result = compare(v1.predicateValues[index], v2.predicateValues[index]) * predicates[index].descending;
				if (result) break;
			}
			return result;
		}
	};

	function processPredicates(sortPredicate, reverseOrder) {
		reverseOrder = reverseOrder ? -1 : 1;
		return sortPredicate.map(function(predicate) {
			var descending = 1, get = identity;

			if (isFunction(predicate)) {
				get = predicate;
			} else if (isString(predicate)) {
				if ((predicate.charAt(0) == '+' || predicate.charAt(0) == '-')) {
					descending = predicate.charAt(0) == '-' ? -1 : 1;
					predicate = predicate.substring(1);
				}
				if (predicate !== '') {
					get = $parse(predicate);
					if (get.constant) {
						var key = get();
						get = function(value) { return value[key]; };
					}
				}
			}
			return { get: get, descending: descending * reverseOrder };
		});
	}

	function isPrimitive(value) {
		switch (typeof value) {
			case 'number': 
			case 'boolean': 
			case 'string':
				return true;
			default:
				return false;
		}
	}

	function objectValue(value, index) {
		// If `valueOf` is a valid function use that
		if (typeof value.valueOf === 'function') {
			value = value.valueOf();
			if (isPrimitive(value)) return value;
		}
		// If `toString` is a valid function and not the one from `Object.prototype` use that
		if (hasCustomToString(value)) {
			value = value.toString();
			if (isPrimitive(value)) return value;
		}
		// We have a basic object so we use the position of the object in the collection
		return index;
	}

	function getPredicateValue(value, index) {
		var type = typeof value;
		if (value === null) {
			type = 'string';
			value = 'null';
		} else if (type === 'string') {
			value = value.toLowerCase();
		} else if (type === 'object') {
			value = objectValue(value, index);
		}
		return { value: value, type: type };
	}

	function compare(v1, v2) {
		var result = 0;
		if (v1.type === v2.type) {
			if (v1.value !== v2.value) {
				result = v1.value < v2.value ? -1 : 1;
			}
		} else {
			result = v1.type < v2.type ? -1 : 1;
		}
		return result;
	}
}


